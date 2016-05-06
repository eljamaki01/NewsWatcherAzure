//
// app_FORKED.js: A Forked Node.js process for off-loading of processing.
// The main Node.js application does not need to have its single thread event processing loop
// burdened by code that takes a while to process.
// Code here will either be run because of a timer function that periodically goes off, or because of
// message sent that schedules it.
//
"use strict";

//
// "require" statements to bring in needed Node Modules
//
var config = require('../config');
var bcrypt = require('bcryptjs');
var DocumentDBClient = require('documentdb').DocumentClient;
var http = require("http");
var async = require('async');

var dbClient = new DocumentDBClient(config.host, { masterKey: config.authKey });

var newsPullBackgroundTimer;
var staleStoryDeleteBackgroundTimer;

console.log('FORK_RUNNING');

process.on('uncaughtException', function (err) {
	console.log('app_FORK.js uncaughtException error: ' + err.message + "\n" + err.stack );
	clearInterval(newsPullBackgroundTimer);
	clearInterval(staleStoryDeleteBackgroundTimer);
	process.disconnect();
})

process.on('message', function (m) {
	if (m.msg) {
		if (m.msg == 'REFRESH_STORIES') {
			setImmediate(function (doc) {
				refreshStoriesMSG(doc, null, null);
			}, m.doc);
		}
	} else {
		console.log('Message from master:', m);
	}
});

//
// Resync news stories after a user has altered their filter.
// For a given user and for every filter they have set up, search all news stories for matches.
//
function refreshStoriesMSG(userDoc, globalNewsDoc, callback) {
	if (!globalNewsDoc) {
		dbClient.readDocument(config.globalNewsStoriesDocumentSelfId, function (err, gDoc, resHeaders) {
			if (err) {
				console.log('FORK_ERROR: global news readDocument() read err:' + err);
				if (callback)
					return callback(err);
				else
					return;
			} else {
				console.log("Master news readDocument RUs: ", resHeaders['x-ms-request-charge']);
				refreshStories(userDoc, gDoc, callback);
			}
		});
	} else {
		refreshStories(userDoc, globalNewsDoc, callback);
	}
}
function refreshStories(userDoc, globalNewsDoc, callback) {
	// Loop through all filters and seek matches for all returned stories
	for (var filterIdx = 0; filterIdx < userDoc.filters.length; filterIdx++) {
		userDoc.filters[filterIdx].newsStories = [];
		
		for (var i = 0; i < globalNewsDoc.newsStories.length; i++) {
			globalNewsDoc.newsStories[i].keep = false;
		}
		
		// If there are keyWords, then filter by them
		if ("keyWords" in userDoc.filters[filterIdx] && userDoc.filters[filterIdx].keyWords[0] != "") {
			var storiesMatched = 0;
			for (var i = 0; i < userDoc.filters[filterIdx].keyWords.length; i++) {
				for (var j = 0; j < globalNewsDoc.newsStories.length; j++) {
					if (globalNewsDoc.newsStories[j].keep == false) {
						var s1 = globalNewsDoc.newsStories[j].title.toLowerCase();
						var s2 = globalNewsDoc.newsStories[j].contentSnippet.toLowerCase();
						var keyword = userDoc.filters[filterIdx].keyWords[i].toLowerCase();
						if (s1.indexOf(keyword) >= 0 || s2.indexOf(keyword) >= 0) {
							globalNewsDoc.newsStories[j].keep = true;
							storiesMatched++;
						}
					}
					if (storiesMatched == config.MAX_FILTER_STORIES)
						break;
				}
				if (storiesMatched == config.MAX_FILTER_STORIES)
					break;
			}
			
			for (var k = 0; k < globalNewsDoc.newsStories.length; k++) {
				if (globalNewsDoc.newsStories[k].keep == true) {
					userDoc.filters[filterIdx].newsStories.push(globalNewsDoc.newsStories[k]);
				}
			}
		}
	}
	
	// For the test runs, we can inject news stories that will be under our control
	if (userDoc.filters.length == 1 &&
        userDoc.filters[0].keyWords.length == 1 
        && userDoc.filters[0].keyWords[0] == "testingKeyword") {
		for (var i = 0; i < 5; i++) {
			userDoc.filters[0].newsStories.push(globalNewsDoc.newsStories[0]);
			userDoc.filters[0].newsStories[0].title = "testingKeyword title" + i;
		}
	}
	
	// Do the replacement of the news stories
	dbClient.replaceDocument(userDoc._self, userDoc, function (err, replaced, resHeaders) {
		if (err) {
			// It could be rare, but a conflict on an individual write might actually happen, but would not be a problem in this case.
			console.log('Replace of newsStories failed:' + JSON.stringify(err.body, null, 4) );
		} else {
			console.log("MASTER scan with User replaceDocument RUs: ", resHeaders['x-ms-request-charge']);
			if (userDoc.filters.length > 0) {
				console.log('MASTERNEWS_UPDATE filter 0 news length = ' + userDoc.filters[0].newsStories.length);
			} else {
				console.log('MASTERNEWS_UPDATE no filters');
			}
		}
		if (callback)
			return callback(err);
	});
}

//
// Refresh all of the news stories in the master list every hour
//
var count = 0;
newsPullBackgroundTimer = setInterval(function () {
	// The Faroo service states that we should not call it more than once a second
	// They have paging for returning of results and seem to always have 100 results and you can get 10 at a time as you page through.
	var date = new Date();
	console.log("app_FORK: datetime tick: " + date.toUTCString());
	async.timesSeries(10, function (n, next) {
		setTimeout(function () {
			var start = (n * 10) + 1;
			console.log('Get news stories from FAROO. Pass #', start);
			try {
				http.get({
					host: 'www.faroo.com',
					path: '/api?q=&start=' + start + '&length=10&rlength=0&l=en&src=news&f=json&key=' + config.FAROO_KEY
				}, function (res) {
					var body = '';
					res.on('data', function (d) {
						body += d;
					});
					res.on('end', function () {
						next(null, body);
					});
				}).on('error', function (err) {
					// handle errors with the request itself
					console.log('Error with the request: ' + err.message);
				});
			}
         catch (err) {
				count++;
				if (count == 3) {
					console.log('app_FORK.js: shuting down timer...too many errors: ' + err.message);
					clearInterval(newsPullBackgroundTimer);
					clearInterval(staleStoryDeleteBackgroundTimer);
					process.disconnect();
				}
				else {
					console.log('app_FORK.js error: ' + err.message + "\n" + err.stack);
				}
			}
		}, 1500);
	}, function (err, results) {
		if (err) {
			console.log('failure');
		} else {
			console.log('success');
			
			// Do the replacement of the news stories in the single master Document holder
			dbClient.readDocument(config.globalNewsStoriesDocumentSelfId, function (err, globalNewsDoc, resHeaders) {
				if (err) {
					console.log('Error with the global news globalNewsDoc read request: ' + JSON.stringify(err.body, null, 4));
				} else {
					console.log("Master news readDocument RUs: ", resHeaders['x-ms-request-charge']);
					globalNewsDoc.newsStories = [];
					for (var i = 0; i < results.length; i++) {
						// JSON.parse is syncronous and it will throw an exception on invalid JSON, so we can catch it
						try {
							var news = JSON.parse(results[i]);
						} catch (e) {
							console.error(e);
							return;
						}
						for (var j = 0; j < news.results.length; j++) {
							var xferNewsStory = {
								link: news.results[j].url,
								imageUrl: news.results[j].iurl,
								title: news.results[j].title,
								contentSnippet: news.results[j].kwic,
								source: news.results[j].domain,
								date: news.results[j].date
							};
							globalNewsDoc.newsStories.push(xferNewsStory);
						}
					}
					
					// Trying async call as sync seemed to clog up the Node processing loop and the documentDB driver kept doing an ECONNRESET
					async.eachSeries(globalNewsDoc.newsStories, function (story, innercallback) {
						bcrypt.hash(story.link, 10, function getHash(err, hash) {
							if (err)
								innercallback(err);
							
							story.storyID = hash.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
							innercallback();
						});
					}, function (err) {
						if (err) {
							console.log('failure on story id creation');
						} else {
							console.log('story id creation success');
							setImmediate(function (doc) {
								refreshAllUserStories(doc);
							}, globalNewsDoc);
						}
					});
				}
			});
		}
	});
}, 120 * 60 * 1000);

function refreshAllUserStories(globalNewsDoc) {
	dbClient.replaceDocument(config.globalNewsStoriesDocumentSelfId, globalNewsDoc, { indexingDirective: "Exclude" }, function (err, replaced, resHeaders) {
		if (err) {
			console.log('err:', err);
			console.log('Error with the global news globalNewsDoc replace request: ' + JSON.stringify(err.body, null, 4));
		} else {
			// For each NewsWatcher user, do news matching on their filters
			console.log("Master news replaceDocument RUs: ", resHeaders['x-ms-request-charge']);
			var cursor = dbClient.queryDocuments(config.collectionSelfId, "SELECT * FROM c where c.type = 'USER_TYPE'");
			var keepProcessing = true;
			async.doWhilst(
				function (callback) {
					cursor.nextItem(function (err, doc) {
						if (doc) {
							refreshStories(doc, globalNewsDoc, function (err) {
								callback(null);
							});
						} else {
							keepProcessing = false;
							callback(null);
						}
					});
				},
            function () { return keepProcessing; },
            function (err) {
					console.log('Timer: News stories refreshed and user filters matched. err:', err);
				});
		}
	});
}


//
// Delete shared news stories that are over three days old.
// Use node-schedule or cron npm modules if want to actually do something like run every morning at 1AM
//
staleStoryDeleteBackgroundTimer = setInterval(function () {
	var querySpec = {
		query: 'SELECT * FROM root r WHERE r.type=@type',
		parameters: [{
				name: '@type',
				value: 'SHAREDSTORY_TYPE'
			}]
	};
	
	dbClient.queryDocuments(config.collectionSelfId, querySpec).toArray(function (err, results) {
		if (err) {
			console.log('Fork could not get shared stories. err:', err);
			return;
		}

		async.eachSeries(results, function (story, innercallback) {
			// Go off the date of the time the story was shared
			var d1 = story.comments[0].dateTime;
			var d2 = Date.now();
			var diff = Math.floor((d2 - d1) / 3600000);
			if (diff > 72) {
				dbClient.deleteDocument(story._self, function (err, deleted, resHeaders) {
					// Don't worry about conflick error, as there is a low chance and we can get it next time around
					innercallback(err);
				});
			} else {
				innercallback();
			}
		}, function (err) {
			if (err) {
				console.log('stale story deletion failure');
			} else {
				console.log('stale story deletion success');
			}
		});
	});
}, 24 * 60 * 60 * 1000);