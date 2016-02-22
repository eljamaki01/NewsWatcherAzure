//
// For things I need handy for one time scripts, like creating and deleteing lots of users.
//
// node miscTestScript.js

var async = require('async');
var assert = require('assert');

//var request = require('supertest')('https://NewsWatcher.azurewebsites.net/'); // To hit production!
//var request = require('supertest')('http://localhost:3000'); // For local testing from command line launching
var request = require('supertest')('http://localhost:1337'); // For local testing for VS launching

var NUM_USERS = 50;
var usersP = [];
for (var i = 0; i < NUM_USERS; i++) {
	usersP.push({ idx: i, email: 'testrunPPP87654980' + i + '@example.com', displayName: 'testrunPPP87654980' + i, password: 'abc123*', token: null, userId: null, savedDoc: null });
}

async.series({
	one: function (callback) { // logins
		console.log("STEP: Log in all accounts");
		async.eachLimit(usersP, 2, function (user, innercallback) {
			request.post("/api/sessions")
         .send({
				email: usersP[user.idx].email,
				password: usersP[user.idx].password
			})
         .end(function (err, res) {
				if (res.status == 201) {
					usersP[user.idx].token = res.body.token;
					usersP[user.idx].userId = res.body.userId;
				}
				innercallback();
			});
		}, function (err) {
			if (err) {
				console.log('User login failure');
			} else {
				console.log('User login success');
			}
			callback(err, 1);
		});
	},
	two: function (callback) { // User account deletions
		console.log("STEP: Delete all test user accounts");
		async.eachLimit(usersP, 2, function (user, innercallback) {
			if (usersP[user.idx].userId != null) {
				request.del("/api/users/" + usersP[user.idx].userId)
				.set('x-auth', usersP[user.idx].token)
				.end(function (err, res) {
					assert.equal(res.status, 200);
					innercallback();
				});
			} else {
				innercallback();
			}
		}, function (err) {
			if (err) {
				console.log('User deletion failure');
			} else {
				console.log('User deletion success');
			}
			callback(err, 1);
		});
	}
},
function (err, results) {
	console.log("END: misc script");
});