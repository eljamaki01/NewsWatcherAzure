// This will be used by the mocha test framework to be digested and run and provide functional testing.
// We want to exercise as much of our web service API as possible..
// First, start up the node.js application locally, or have it deployed to point to.
// node server.js
// Then you can run mocha from the local project install.
// .\node_modules\.bin\mocha --timeout 30000 functional_api_crud.js
//

//var bcrypt = require('bcryptjs');
var assert = require('assert');

//var request = require('supertest')('https://NewsWatcher.azurewebsites.net/'); // To hit production!
//var request = require('supertest')('http://localhost:3000'); // For local testing from command line launching
var request = require('supertest')('http://localhost:1337'); // For local testing for VS launching

describe('User cycle operations', function () {
	var token;
	var userId;
	var savedDoc;
	
	it("should deny unregistered user a login attempt", function (done) {
		request.post("/api/sessions").send({
			email: 'bush@sample.com',
			password: 'abc123*'
		})
      .end(function (err, res) {
			assert.equal(res.status, 500);
			done();
		});
	});
	
	it("should create a new registered User", function (done) {
		request.post("/api/users")
      .send({
			email: 'bush@sample.com',
			displayName: 'Bushman',
			password: 'abc123*'
		})
        .end(function (err, res) {
			assert.equal(res.status, 201);
			assert.equal(res.body.displayName, "Bushman", "Name of user should be as set");
			done();
		});
	});
	
	it("should not create a User twice", function (done) {
		request.post("/api/users")
      .send({
			email: 'bush@sample.com',
			displayName: 'Bushman',
			password: 'abc123*'
		})
      .end(function (err, res) {
			assert.equal(res.status, 500);
			assert.equal(res.body.message, "Error: Email account already registered", "Error should be already registered");
			done();
		});
	});
	
	it("should detect incorrect password", function (done) {
		request.post("/api/sessions")
      .send({
			email: 'bush@sample.com',
			password: 'wrong1*'
		})
      .end(function (err, res) {
			assert.equal(res.status, 500);
			assert.equal(res.body.message, "Error: Wrong password", "Error should be already registered");
			done();
		});

	});
	
	it("should allow registered user to login", function (done) {
		request.post("/api/sessions")
      .send({
			email: 'bush@sample.com',
			password: 'abc123*'
		})
      .end(function (err, res) {
			token = res.body.token;
			userId = res.body.userId;
			assert.equal(res.status, 201);
			assert.equal(res.body.msg, "Authorized", "Message should be AUthorized");
			done();
		});
	});
	
	it("should allow access if logged in", function (done) {
		request.get("/api/users/" + userId)
      .set('x-auth', token)
      .end(function (err, res) {
			assert.equal(res.status, 200);
			done();
		});
	});
	
	it("should update the profile with new news filters", function (done) {
		request.put("/api/users/" + userId)
      .send({
			settings: {
				requireWIFI: true,
				enableAlerts: false
			},
			filters: [{
					name: 'Politics',
					keyWords: ["Obama", "Clinton", "Bush", "Trump", "Putin"],
					enableAlert: false,
					alertFrequency: 0,
					enableAutoDelete: false,
					deleteTime: 0,
					timeOfLastScan: 0
				},
				{
					name: 'Countries',
					keyWords: ["United States", "China", "Russia", "Israel", "India", "Iran"],
					enableAlert: false,
					alertFrequency: 0,
					enableAutoDelete: false,
					deleteTime: 0,
					timeOfLastScan: 0
				}]
		})
      .set('x-auth', token)
      .end(function (err, res) {
			assert.equal(res.status, 200);
			done();
		});
	});
	
	it("should return updated news stories", function (done) {
		setTimeout(function () {
			request.get("/api/users/" + userId)
         .set('x-auth', token)
         .end(function (err, res) {
				assert.equal(res.status, 200);
				savedDoc = res.body.filters[0].newsStories[0];
				done();
			});
		}, 3000);
	});
	
	it("should move a news story to the savedStories folder", function (done) {
		request.post("/api/users/" + userId + "/savedstories")
      .send(savedDoc)
      .set('x-auth', token)
      .end(function (err, res) {
			assert.equal(res.status, 200);
			done();
		});
	});
	
	it("should delete a news story from the savedStories folder", function (done) {
		request.del("/api/users/" + userId + "/savedstories/" + savedDoc.storyID)
      .set('x-auth', token)
      .end(function (err, res) {
			assert.equal(res.status, 200);
			done();
		});
	});
	
	it("should allow registered user to logout", function (done) {
		request.del("/api/sessions/" + userId)
      .set('x-auth', token)
      .end(function (err, res) {
			assert.equal(res.status, 200);
			done();
		});
	});
	
	
	it("should not allow access if not logged in", function (done) {
		request.get("/api/users/" + userId)
      .end(function (err, res) {
			assert.equal(res.status, 500);
			done();
		});
	});
	
	it("should allow registered user to login", function (done) {
		request.post("/api/sessions")
      .send({
			email: 'bush@sample.com',
			password: 'abc123*'
		})
      .end(function (err, res) {
			token = res.body.token;
			userId = res.body.userId;
			assert.equal(res.status, 201);
			assert.equal(res.body.msg, "Authorized", "Message should be AUthorized");
			done();
		});
	});
	
	it("should delete a registered User", function (done) {
		request.del("/api/users/" + userId)
      .set('x-auth', token)
      .end(function (err, res) {
			assert.equal(res.status, 200);
			done();
		});
	});
	
	it('should return a 404 for invalid requests', function (done) {
		request.get('/blah')
      .end(function (err, res) {
			assert.equal(res.status, 404);
			done();
		});
	});
});

describe('News sharing and commenting operations', function () {
	var token;
	var userId;
	var storyID;
	var savedDoc;
	
	it("should create a new registered User", function (done) {
		request.post("/api/users")
      .send({
			email: 'bush@sample.com',
			displayName: 'Bushman',
			password: 'abc123*'
		})
      .end(function (err, res) {
			assert.equal(res.status, 201);
			assert.equal(res.body.displayName, "Bushman", "Name of user should be as set");
			done();
		});
	});
	
	it("should allow registered user to login", function (done) {
		request.post("/api/sessions")
      .send({
			email: 'bush@sample.com',
			password: 'abc123*'
		})
      .end(function (err, res) {
			token = res.body.token;
			userId = res.body.userId;
			assert.equal(res.status, 201);
			assert.equal(res.body.msg, "Authorized", "Message should be AUthorized");
			done();
		});
	});
	
	it("should update the profile with new news filters", function (done) {
		request.put("/api/users/" + userId)
      .send({
			settings: {
				requireWIFI: true,
				enableAlerts: false
			},
			filters: [{
					name: 'Words',
					keyWords: ["a", "the", "and"],
					enableAlert: false,
					alertFrequency: 0,
					enableAutoDelete: false,
					deleteTime: 0,
					timeOfLastScan: 0
				}]
		})
      .set('x-auth', token)
      .end(function (err, res) {
			assert.equal(res.status, 200);
			done();
		});
	});
	
	// We need the delay, as the background process will update the news stories with the changed filters
	it("should return updated news stories", function (done) {
		setTimeout(function () {
			request.get("/api/users/" + userId)
         .set('x-auth', token)
         .end(function (err, res) {
				savedDoc = res.body.filters[0].newsStories[0];
				assert.equal(res.body.filters[0].keyWords[0], 'a');
				done();
			});
		}, 3000);
	});
	
	it("should create a shared news story", function (done) {
		request.post("/api/sharednews")
      .send(savedDoc)
      .set('x-auth', token)
      .end(function (err, res) {
			assert.equal(res.status, 201);
			done();
		});
	});
	
	it("should return shared news story and comment", function (done) {
		request.get("/api/sharednews")
      .set('x-auth', token)
      .end(function (err, res) {
			assert.equal(res.status, 200);
			storyID = res.body[0].story.storyID;
			done();
		});
	});
	
	it("should add a new comment", function (done) {
		request.post("/api/sharednews/" + storyID + "/Comments")
      .send({ comment: "This is amazing news!" })
      .set('x-auth', token)
      .end(function (err, res) {
			assert.equal(res.status, 201);
			done();
		});
	});
	
	it("should have the added comment for the news story", function (done) {
		setTimeout(function () {
			request.get("/api/sharednews")
         .set('x-auth', token)
         .end(function (err, res) {
				assert.equal(res.status, 200);
				assert.equal(res.body[0].comments[1].comment, "This is amazing news!", "Comment should be there");
				done();
			});
		}, 1000);
	});
	
	it("should delete the shared news story", function (done) {
		request.del("/api/sharednews/" + storyID)
      .set('x-auth', token)
      .end(function (err, res) {
			assert.equal(res.status, 200);
			done();
		});
	});
	
	it("should delete a registered User", function (done) {
		request.del("/api/users/" + userId)
      .set('x-auth', token)
      .end(function (err, res) {
			assert.equal(res.status, 200);
			done();
		});
	});
});