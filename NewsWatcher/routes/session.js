//
// session.js: A Node.js Module for session login and logout route handling.
//

"use strict";
var express = require('express');
var bcrypt = require('bcryptjs'); // For password hash comparing
var jwt = require('jwt-simple'); // For token authentication
var joi = require('joi'); // For data validation
var authHelper = require('./authHelper');
var config = require('../config');

var router = express.Router();

//
// Create a security token as user login time that can be passed to the client and used on subsequent calls.
// The user email and password are sent in the body of the request.
//
router.post('/', function postSession(req, res, next) {
	// joi validation: Password must be 7 to 15 characters in length and contain at least one numeric digit and a special character
	var schema = {
		email: joi.string().email().min(7).max(50).required(),
		password: joi.string().regex(/^(?=.*[0-9])(?=.*[!@#$%^&*])[a-zA-Z0-9!@#$%^&*]{7,15}$/).required()
	};
	
	joi.validate(req.body, schema, function (err, value) {
		if (err)
			return next(new Error('Invalid field: password 7 to 15 (one number, one special character)'));

		var querySpec = {
			query: 'SELECT * FROM root r WHERE r.type=@type AND r.email=@email',
			parameters: [{
					name: '@type',
					value: 'USER_TYPE'
				},
				{
					name: '@email',
					value: req.body.email
				}]
		};
		
		req.db.client.queryDocuments(req.db.collection_self, querySpec).toArray(function queryUserDocs(err, results) {
			if (err)
				return next(err);
			
			var user = results[0];
			if (user) {
				bcrypt.compare(req.body.password, user.passwordHash, function comparePassword(err, match) {
					if (match) {
						var token = jwt.encode({ authorized: true, sessionIP: req.ip, sessionUA: req.headers['user-agent'], userId: user.id, _self: user._self, displayName: user.displayName }, config.JWT_SECRET);
						res.status(201).json({ displayName : user.displayName, userId : user.id, token: token, msg: 'Authorized' });
					} else {
						return next(new Error('Wrong password'));
					}
				});
			} else {
				return next(new Error('User was not found.'));
			}
		});
	});
});

//
// Delete the token as a user logs out
//
router.delete('/:id', authHelper.checkAuth, function (req, res, next) {
	// Verify that the passed in token is the same as that in the auth token
	if (req.params.id != req.auth.userId)
		return next(new Error('Invalid request for logout'));
	
	res.status(200).json({ msg: 'Logged out' });
});

module.exports = router;