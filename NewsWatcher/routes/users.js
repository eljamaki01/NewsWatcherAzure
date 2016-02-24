//
// users.js: A Node.js Module for for management of a NewsWatcher user settings and news filters CRUD operations.
// There is middleware that makes sure a user is logged in so they are the only ones to get at their own profile.
// A profile is really associated with a user and never goes away,
//

"use strict";
var express = require('express');
var bcrypt = require('bcryptjs');
var async = require('async');
var joi = require('joi'); // For data validation
var authHelper = require('./authHelper');
var config = require('../config');
var q = require('./asyncQHelper');

var router = express.Router();

//
// Create a User in the DocumentDB Collection for NewsWatcher.
// This does not require session authentication at this point as this is the registration step.
//
router.post('/', function postUser(req, res, next) {
	// joi validation: Password must be 7 to 15 characters in length and contain at least one numeric digit and a special character
	var schema = {
		displayName: joi.string().alphanum().min(3).max(50).required(),
		email: joi.string().email().min(7).max(50).required(),
		password: joi.string().regex(/^(?=.*[0-9])(?=.*[!@#$%^&*])[a-zA-Z0-9!@#$%^&*]{7,15}$/).required()
	};
	
	joi.validate(req.body, schema, function (err, value) {
		if (err)
			return next(new Error('Invalid field: display name 3 to 50 alpanumeric, valid email, password 7 to 15 (one number, one special character)'));
		
		findUserByEmail(req.db, req.body.email, function findUser(err, doc) {
			if (err)
				return next(err);
			
			if (doc)
				return next(new Error('Email account already registered'));
			
			var xferUser = {
				type : 'USER_TYPE',
				displayName: req.body.displayName,
				email: req.body.email,
				passwordHash: null,
				date: Date.now(),
				completed: false,
				settings : {
					requireWIFI: true,
					enableAlerts: false
				},
				filters : [{
						name: 'Technology Companies',
						keyWords : ['Apple', 'Microsoft', 'IBM', 'Amazon', 'Google', 'Intel'],
						enableAlert : false,
						alertFrequency : 0,
						enableAutoDelete : false,
						deleteTime : 0,
						timeOfLastScan : 0,
						newsStories : []
					}],
				savedStories: []
			};
			
			bcrypt.hash(req.body.password, 10, function getHash(err, hash) {
				if (err)
					return next(err);
				
				xferUser.passwordHash = hash;
				req.db.client.createDocument(req.db.collection_self, xferUser, { consistencyLevel : "Session" }, function createUser(err, doc, resHeaders) {
					if (err)
						return next(err);
					
					console.log("User createDocument RUs: ", resHeaders['x-ms-request-charge']);
					req.node2.send({ msg: 'REFRESH_STORIES', doc: doc });
					res.status(201).json(doc);
				});
			});
		});
	});
});

//
// Delete a User DocumentDB
//
router.delete('/:id', authHelper.checkAuth, function (req, res, next) {
	// Verify that the passed in token is the same as that in the auth token
	if (req.params.id != req.auth.userId)
		return next(new Error('Invalid request for account deletion'));
	
	q.push({ fcn: deleteUser, params: { retryCount: 0, req: req, res: res, next: next } }, function (err) {
		if (err) {
			console.log('Finished processing deleteUser. err:', err);
		}
	});
});
function deleteUser(params, callback) {
	params.req.db.client.deleteDocument(params.req.auth._self, function (err, resource, resHeaders) {
		if (err)
			params.next(err);
		else {
			console.log("deleteUser deleteDocument RUs: ", resHeaders['x-ms-request-charge']);
			params.res.status(200).json({ msg: "User Deleted" });
		}
		
		// If we are called from the async queue, calling callback() will tell the queue to move on
		if (callback) callback();
	});
}

//
// Get a NewsWatcher user
//
router.get('/:id', authHelper.checkAuth, function (req, res, next) {
	// Verify that the passed in token is the same as that in the auth token
	if (req.params.id != req.auth.userId)
		return next(new Error('Invalid request for account fetch'));
	
	req.db.client.readDocument(req.auth._self, function (err, doc, resHeaders) {
		if (err) {
			next(err);
		} else {
			console.log("User readDocument RUs: ", resHeaders['x-ms-request-charge']);
			var xferProfile = {
				email: doc.email,
				displayName: doc.displayName,
				date: doc.date,
				settings : doc.settings,
				filters : doc.filters,
				savedStories: doc.savedStories
			};
			res.header("Cache-Control", "no-cache, no-store, must-revalidate");
			res.header("Pragma", "no-cache");
			res.header("Expires", 0);
			res.status(200).json(xferProfile);
		}
	});
});

//
// Update a user profile. For example, they may have edited their news filters.
//
router.put('/:id', authHelper.checkAuth, function (req, res, next) {
	// Verify that the passed in token is the same as that in the auth token
	if (req.params.id != req.auth.userId)
		return next(new Error('Invalid request for account deletion'));
	
	// Limit the number of filters
	if (req.body.filters.length > config.MAX_FILTERS)
		return next(new Error('Too many news filters'));
	
	// clear out leading and trailing spaces
	for (var i = 0; i < req.body.filters.length; i++) {
		if ("keyWords" in req.body.filters[i] && req.body.filters[i].keyWords[0] != "") {
			for (var j = 0; j < req.body.filters[i].keyWords.length; j++) {
				req.body.filters[i].keyWords[j] = req.body.filters[i].keyWords[j].trim();
			}
		}
	}
	
	// Validate the filters
	var schema = {
		name: joi.string().min(1).max(30).regex(/^[-_ a-zA-Z0-9]+$/).required(),
		keyWords: joi.array().max(10).items(joi.string().max(20)).required(),
		enableAlert: joi.boolean(),
		alertFrequency: joi.number().min(0),
		enableAutoDelete: joi.boolean(),
		deleteTime: joi.date(),
		timeOfLastScan: joi.date(),
		newsStories: joi.array(),
		keywordsStr: joi.string().min(1).max(100)
	};
	
	async.eachSeries(req.body.filters, function (filter, innercallback) {
		joi.validate(filter, schema, function (err, value) {
			innercallback(err);
		});
	}, function (err) {
		if (err) {
			return next(err);
		} else {
			q.push({ fcn: putUser, params: { retryCount: 0, req: req, res: res, next: next } }, function (err) {
				if (err) {
					console.log('Finished processing putUser. err:', err);
				}
			});
		}
	});
});
function putUser(params, callback) {
	params.req.db.client.readDocument(params.req.auth._self, function (err, doc, resHeaders) {
		if (err) {
			if (callback) callback();
			return params.next(err);
		}
		
		console.log("putUser readDocument RUs: ", resHeaders['x-ms-request-charge']);
		// Just replace what needs to be updated
		doc.settings.requireWIFI = params.req.body.requireWIFI;
		doc.settings.enableAlerts = params.req.body.enableAlerts;
		doc.filters = [];
		doc.filters = params.req.body.filters;
		for (var i = 0; i < doc.filters.length; i++) {
			doc.filters[i].newsStories = [];
		}
		
		params.req.db.client.replaceDocument(params.req.auth._self, doc, function (err, repDoc, resHeaders) {
			if (err)
				params.next(err);
			else {
				console.log("putUser replaceDocument RUs: ", resHeaders['x-ms-request-charge']);
				params.req.node2.send({ msg: 'REFRESH_STORIES', doc: repDoc });
				params.res.status(200).json(repDoc);
			}
			
			// If we are called from the async queue, calling callback() will tell the queue to move on
			if (callback) callback();
		});
	});
}

//
// Move a story to the save folder.
// We can't move a story there that is already there. We compare the link to tell.
// There is a limit to how many can be saved.
//
router.post('/:id/savedstories', authHelper.checkAuth, function (req, res, next) {
	// Verify that the token matches
	if (req.params.id != req.auth.userId)
		return next(new Error('Invalid request for account deletion'));
	
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
		if (err)
			return next(err);
		
		q.push({ fcn: postSavedStoryUser, params: { retryCount: 0, req: req, res: res, next: next } }, function (err) {
			if (err) {
				console.log('Finished processing postSavedStoryUser. err:', err);
			}
		});
	});
});
function postSavedStoryUser(params, callback) {
	var foundStory = false;
	
	params.req.db.client.readDocument(params.req.auth._self, function (err, doc, resHeaders) {
		if (err) {
			if (callback) callback();
			return params.next(err);
		}
		
		console.log("postSavedStoryUser readDocument RUs: ", resHeaders['x-ms-request-charge']);
		
		if (doc.savedStories.length > 30) {
			if (callback) callback();
			return params.next(new Error("Saved story limit reached."));
		}
		
		for (var i = 0; i < doc.savedStories.length; i++) {
			if (doc.savedStories[i].storyID == params.req.body.storyID) {
				foundStory = true;
				break;
			}
		}
		if (foundStory) {
			if (callback) callback();
			return params.next(new Error("Story was already saved."));
		}
		
		doc.savedStories.push(params.req.body);
		params.req.db.client.replaceDocument(params.req.auth._self, doc, function (err, repDoc, resHeaders) {
			if (err) {
				params.next(err);
			} else {
				console.log("postSavedStoryUser replaceDocument RUs: ", resHeaders['x-ms-request-charge']);
				params.res.status(200).json(repDoc);
			}
			
			if (callback) callback();
		});
	});
}

//
// Delete a story from the save folder.
//
router.delete('/:id/savedstories/:sid', authHelper.checkAuth, function (req, res, next) {
	// Verify that the passed in auth token matches
	if (req.params.id != req.auth.userId)
		return next(new Error('Invalid request for account deletion'));
	
	q.push({ fcn: deleteSavedStoryUser, params: { retryCount: 0, req: req, res: res, next: next } }, function (err) {
		if (err) {
			console.log('Finished processing deleteSavedStoryUser. err:', err);
		}
	});
});
function deleteSavedStoryUser(params, callback) {
	var foundStory = false;
	
	params.req.db.client.readDocument(params.req.auth._self, function (err, doc, resHeaders) {
		if (err) {
			if (callback) callback();
			return params.next(err);
		}
		
		console.log("deleteSavedStoryUser readDocument RUs: ", resHeaders['x-ms-request-charge']);
		for (var i = 0; i < doc.savedStories.length; i++) {
			if (doc.savedStories[i].storyID == params.req.params.sid) {
				foundStory = true;
				doc.savedStories.splice(i, 1);
				break;
			}
		}
		if (!foundStory) {
			if (callback) callback();
			return params.next(new Error("Story was not found to delete."));
		}
		
		params.req.db.client.replaceDocument(params.req.auth._self, doc, function (err, repDoc, resHeaders) {
			if (err) {
				params.next(err);
			} else {
				console.log("deleteSavedStoryUser replaceDocument RUs: ", resHeaders['x-ms-request-charge']);
				params.res.status(200).json(repDoc);
			}
			
			// If we are called from the async queue, call callback() to tell the queue to move on
			if (callback) callback();
		});
	});
}

//
// Helper function to find a user
//
function findUserByEmail(db, email, callback) {
	var querySpec = {
		query: 'SELECT * FROM root r WHERE r.type=@type AND r.email=@email',
		parameters: [{
				name: '@type',
				value: 'USER_TYPE'
			},
			{
				name: '@email',
				value: email
			}]
	};
	
	db.client.queryDocuments(db.collection_self, querySpec).toArray(function (err, results) {
		if (err) {
			callback(err);
		} else {
			callback(null, results[0]);
		}
	});
}

module.exports = router;