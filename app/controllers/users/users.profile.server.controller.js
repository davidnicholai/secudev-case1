'use strict';

/**
 * Module dependencies.
 */
var _ = require('lodash'),
	errorHandler = require('../errors.server.controller.js'),
	mongoose = require('mongoose'),
	passport = require('passport'),
	User = mongoose.model('User');

/**
 * Update user details
 */
exports.update = function(req, res) {
	var user = req.user;
	var message = null;
	var logout = false;

	if (user.roles === 'admin' && req.body.roles === 'user')
		logout = true;

	if (user) {
		user = _.extend(user, req.body);
		user.updated = Date.now(); // Update the 'updated' field with the current date

		user.save(function(err) {
			if (err) {
				return res.status(400).send({
					message: errorHandler.getErrorMessage(err)
				});
			} else {
				user.password = undefined;
				user.salt = undefined;

				if (logout) {
					req.logout();
					res.redirect('/#!/signin');
				} else {				
					req.login(user, function(err) {
						if (err) {
							res.status(400).send(err);
						} else {
							res.json(user);
						}					
					});
				}
			}
		});
	} else {
		res.status(400).send({
			message: 'User is not signed in'
		});
	}
};

/**
 * Send User
 */
exports.me = function(req, res) {
	res.json(req.user || null);
};