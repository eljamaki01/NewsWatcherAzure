//
// sharedNews.js: A Node.js Module for shared news story management.
//
// Each shared story is kept in its own Document.
//
// Users cannot delete individual stories, so there is no delete verb provided except for testing purposes.
// There is a background timer that deletes shared stories that are over a week old in the forked process code.
//

"use strict";
var express = require('express');
var joi = require('joi'); // For data validation
var authHelper = require('./authHelper');
var config = require('../config');
var q = require('./asyncQHelper');

var router = express.Router();

//
// Share a story for all NewsWatcher users to see and comment on.
// Don't allow a story to be shared twice. We compare the id/link to tell.
// There is a limit to how many stories can be shared.
//
router.post('/', authHelper.checkAuth, function (req, res, next) {
	var foundStory = false;
	
	// Validate the body
	var schema = {
		contentSnippet: joi.string().max(200).required(),
		date: joi.date().required(),
		hours: joi.string().max(20),
		imageUrl: joi.string().max(300).required(),
		keep: joi.boolean().required(),
		link: joi.string().max(300).required(),
		source: joi.string().max(50).required(),
		storyID: joi.string().max(100).required(),
		title: joi.string().max(200).required()
	};
	
	joi.validate(req.body, schema, function (err, value) {
		if (err) {
			return next(err);
		} else {
			// We first make sure we are not at the 100 count limit.
			// In theory, we don't need to use the continuation token since we are limiting the number to 30 anyway
			req.db.client.executeStoredProcedure(config.countSProcSelfId, ["SELECT * FROM c where c.type = 'SHAREDSTORY_TYPE'", null], function (err, resource, resHeaders) {
				if (err)
					return next(err);
				
				console.log("SharedNews count executeStoredProcedure RUs: ", resHeaders['x-ms-request-charge']);
				
				// Just a sanity check to make sure that no continuation token is ever returned
				if (resource.continuationToken != null)
					return next(new Error('Issue with count stored procedure'));
				
				if (resource.count > config.MAX_SHARED_STORIES)
					return next(new Error('Shared story limit reached'));
				
				// Make sure the story was not already shared
				var docLink = config.collPath + req.body.storyID;
				
				req.db.client.readDocument(docLink, function (err, doc, resHeaders) {
					if (err && (err.code != 404))
						return next(err);
					if (doc)
						return next(new Error('Story was already shared.'));
					
					console.log("User readDocument RUs: ", resHeaders['x-ms-request-charge']);
					
					// Create this as a shared news story Document.
					// Note that we don't need to worry about simultaneous post requests creating the same story,
					// id uniqueness will force that and fail other requests.
					var xferStory = {
						id : req.body.storyID,
						type : 'SHAREDSTORY_TYPE',
						story: req.body,
						comments : [{
								displayName: req.auth.displayName,
								userId : req.auth.userId,
								dateTime: Date.now(),
								comment: req.auth.displayName + " thought everyone might enjoy this!"
							}]
					};
					
					req.db.client.createDocument(req.db.collection_self, xferStory, function (err, createdDoc, resHeaders) {
						if (err)
							return next(err);
						
						console.log("SharedNews createDocument RUs: ", resHeaders['x-ms-request-charge']);
						res.status(201).json(createdDoc);
					});
				});
			});
		}
	});
});

//
// Return all the shared news stories. Call the middleware authHelper.checkAuth first to verify we have a logged in user.
//
router.get('/', authHelper.checkAuth, function (req, res, next) {
	var querySpec = {
		query: 'SELECT * FROM root r WHERE r.type=@type',
		parameters: [{
				name: '@type',
				value: 'SHAREDSTORY_TYPE'
			}]
	};
	
	req.db.client.queryDocuments(req.db.collection_self, querySpec).toArray(function (err, results) {
		if (err)
			return next(err);
		
		res.status(200).json(results);
	});
});

//
// Delete a story from the shared folder.
//
router.delete('/:sid', authHelper.checkAuth, function (req, res, next) {
	//deleteSharedStory(0, req, res);
	var docLink = config.collPath + req.params.sid;
	
	// Can't call deleteDocument directly as parallel calls comming in must always be serialized with the queue.
	q.push({ fcn: deleteSharedStory, params: { retryCount: 0, req: req, res: res, next: next } }, function (err) {
		if (err) {
			console.log('Finished processing deleteSharedStory. ERR: ', err);
		}
	});
});
function deleteSharedStory(params, callback) {
	params.req.db.client.deleteDocument(config.collPath + params.req.params.sid, function (err, deleted, resHeaders) {
		if (err) {
			params.next(err);
		} else {
			console.log("SharedNews deleteDocument RUs: ", resHeaders['x-ms-request-charge']);
			params.res.status(200).json({ msg: "Shared story deleted" });
		}
		
		// Call callback() to tell the queue to move on
		callback();
	});
}

//
// Post a comment from a user to a shared news story.
//
router.post('/:sid/Comments', authHelper.checkAuth, function (req, res, next) {
	// Validate the body with joi
	var schema = {
		comment: joi.string().max(250).required()
	};
	
	joi.validate(req.body, schema, function (err, value) {
		if (err) {
			return next(err);
		} else {
			q.push({ fcn: postSharedStoryComment, params: { retryCount: 0, req: req, res: res, next: next } }, function (err) {
				if (err) {
					console.log('Finished processing postSharedStoryComment. ERR: ', err);
				}
			});
		}
	});
});
function postSharedStoryComment(params, callback) {
	params.req.db.client.readDocument(config.collPath + params.req.params.sid, function (err, doc, resHeaders) {
		if (err) {
			callback();
			return params.next(err);
		}
		
		console.log("postSharedStoryComment readDocument RUs: ", resHeaders['x-ms-request-charge']);
		var xferComment = {
			displayName: params.req.auth.displayName,
			userId : params.req.auth.userId,
			dateTime: Date.now(),
			comment: params.req.body.comment.substring(0, 250)
		};
		
		// Limit comments to 30 per story
		if (doc.comments.length > config.MAX_COMMENTS) {
			callback();
			return params.next(new Error("Comment limit reached"));
		}
		
		doc.comments.push(xferComment);
		params.req.db.client.replaceDocument(doc._self, doc, function (err, replaced, resHeaders) {
			if (err) {
				params.next(err);
			} else {
				console.log("postSharedStoryComment replaceDocument RUs: ", resHeaders['x-ms-request-charge']);
				params.res.status(201).json({ msg: "Comment added" });
			}
			callback();
		});
	});
}

module.exports = router;