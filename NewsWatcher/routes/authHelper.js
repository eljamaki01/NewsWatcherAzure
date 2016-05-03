//
// authHelper.js: A Node.js Module to inject middleware that validates the request header User token.
//

"use strict";
var jwt = require('jwt-simple');
var config = require('../config');

//
// Check for a token in the custom header setting and verify that it is signed and has not been tampered with.
// If no header token is present, it might just be that the user is not signed in.
//
module.exports.checkAuth = function (req, res, next) {
	if (req.headers['x-auth']) {
		try {
			req.auth = jwt.decode(req.headers['x-auth'], config.JWT_SECRET);
			

			
			var ipStr;
			var n = req.ip.indexOf(':');
			if (n !== -1) {
				ipStr = req.ip.substring(0, n);
			} else {
				ipStr = req.ip;
			}
			
			if (req.auth && req.auth.authorized && req.auth.userId && req.auth.sessionIP === ipStr && req.auth.sessionUA === req.headers['user-agent']) {
				return next();
			} else {
				return next(new Error('User is not logged in.'));
			}
		} catch (err) {
			return next(err);
		}
	} else {
		return next(new Error('User is not logged in.'));
	}
};