'use strict';

/**
 * Module dependencies.
 */
var mongoose = require('mongoose'),
    Cart = mongoose.model('Cart'),
    User = mongoose.model('User'),
    Item = mongoose.model('Item'),
    Transaction = mongoose.model('Transaction'),
    _ = require('lodash'),
    paypal = require('paypal-rest-sdk');

exports.executeTransaction = function (req, res) {
  Transaction.findOne( { paymentId : req.body.paymentId }, function (err, transaction) {
    if (err || !transaction) return res.status(400).send({ message: 'An error occured while retrieving your transaction' });

    var payer = {
      payer_id: req.body.PayerID
    };

    paypal.payment.execute(transaction.paymentId, payer, {}, function (err, response) {
      if (err) return res.status(400).send({ message: 'An error occured while executing your transaction' });

      console.log(JSON.stringify(response));
      transaction.paid = true;
      transaction.save(function (err) {
        if (err) return res.status(400).send({ message: 'An error occured while saving your transaction' });
        res.send({ message: 'Successfully performed payment' });
      });
    }); // Closing of paypal.payment.execute()

  });
};

exports.getTransaction = function (req, res) {
  Transaction.findOne( { paymentId : req.params.paymentId }, function (err, transaction) {
    if (err || !transaction) return res.status(400).send({ message: 'An error occured while retrieving your transaction' });

    res.json(transaction);
  });
};

exports.checkout = function (req, res) {
  var totalPrice = 0;

  Cart.findOne({ user: req.user._id }).lean().exec(function (err, cart) {
    if (err) {
      return res.status(400).send({
        message: 'Failed to load Cart'
      });
    } else if (!cart) {
      return res.status(400).send({
        message: 'Cart does not exist'
      });
    } else if (cart) {
      var itemIds = [];
      for (var i = 0; i < cart.content.length; i++) {
        itemIds.push(cart.content[i].item);
      }

      Item.find( { _id: { $in: itemIds } } ).lean().exec(function (err, items) {
        if (err) {
          return res.status(400).send({
            message: 'Item not found'
          });
        }

        for (var j = 0; j < cart.content.length; j++)
          for (var k = 0; k < items.length; k++)
            if (cart.content[j].item.toString() === items[k]._id.toString())
              cart.content[j].itemInfo = items[k];

        for (var idx = 0; idx < cart.content.length; idx++)
          totalPrice += cart.content[idx].itemInfo.price * cart.content[idx].quantity;

        paypal.configure({
          'host': 'api.sandbox.paypal.com',
          'port': '',
          'client_id': 'ATyYbJ3d4N-YauTExji9RlkJuF3-rzhAcDHAv0VraepSxpuWq0TBkZa6dxjgGC1hcRwQK5BorV14fItx',
          'client_secret': 'EKOUGLXGTHd6t5Xjk8S2l9ei5ultHi4jRPfNbLkeuuw4eY9nOqVnSRahnT3V9XHee43CB74V7O-aOeNt'
        });

        var paypalPayment = {
          'intent': 'sale',
          'payer': { 'payment_method': 'paypal' },
          'redirect_urls': {},
          'transactions': [{
            'amount': {
              'currency': 'USD'
            }
          }]
        };

        paypalPayment.transactions[0].amount.total = totalPrice;
        paypalPayment.redirect_urls.return_url = 'https://104.131.183.220/#!/shop/cart/confirm';
        paypalPayment.redirect_urls.cancel_url = 'https://104.131.183.220/#!/shop/cart';
        paypalPayment.transactions[0].description = 'Total Price: $' + totalPrice;
        
        paypal.payment.create(paypalPayment, {}, function (err, response) {
          if (err) { // Render order-failure.server.view.html
            res.render('order-failure', { message: [{desc: 'Payment API call failed. Please navigate back to the page.', type: 'error'}]});
          }

          if (response) {
            console.log('response: ' + JSON.stringify(response));
            var link = response.links;

            var transaction = new Transaction();
            transaction.paymentId = response.id;
            transaction.user = cart.user;
            transaction.paid = false;
            transaction.datePaid = new Date();

            for (var i = 0; i < cart.content.length; i++) {
              transaction.order.push({item: cart.content[i].item, quantity: cart.content[i].quantity});
            }

            transaction.save(function (err) {
              if (err) {
                console.log(err);
                return res.status(400).send({
                  message: 'Error while saving transaction'
                });
              } else {
                for (var i = 0; i < link.length; i++) {
                  if (link[i].rel === 'approval_url') {
                    res.redirect(link[i].href);
                  }
                }
              }
            });
          }
        }); // Closing brace of paypal.payment.create()
      
      });
    }

  });

};

exports.removeFromCart = function (req, res) {
  Cart.findOne({ user: req.user._id }, function (err, cart) {
    if (err) {
      return res.status(400).send({
        message: err
      });
    } else {
      var newContent = cart.content;
      for (var i = 0; i < newContent.length; i++) {
        if (req.body.item.toString() === newContent[i].item.toString())
          newContent.splice(i, 1);
        continue;
      }

      Cart.update( { user: req.user._id }, { content: newContent }, function (err2, updatedCart) {
        if (err) {
          return res.status(400).send({
            message: err2
          });
        }

        res.json(updatedCart);
      }); 
    }
  });

};

exports.addToCart = function (req, res) {

  if (req.body.quantity < 0 || req.body.quantity.match(/[0-9]+/) === null || req.body.quantity % 1 !== 0) {
    return res.status(400).send({
      message: 'Please input a valid quantity'
    });
  }

  Cart.findOne({ user: req.user._id }, function (err, user) {
    if (err) {
      return res.status(400).send({
        message: err
      });
    } else if (!user) { // If the user doesn't have a cart EVER.
      if (req.body.quantity < 1) {
        return res.status(400).send({
          message: 'Please input a valid quantity'
        });
      }
      
      var cart = new Cart();
      cart.user = req.user;
      cart.content.push({ item: req.body.item._id, quantity: req.body.quantity });

      cart.save(function (err2, cart) {
        if (err) {
          return res.status(400).send({
            message: err2
          });
        } else {
          res.send({
            message: 'Successfully added to cart'
          });
        }
      });
    } else { // If the user already has a cart.
      var alreadyOrdered = false;
      for (var i = 0; i < user.content.length; i++) { // Check if the user already added this item before.
        if (user.content[i].item.toString() === req.body.item._id.toString()) {
          alreadyOrdered = true;
          user.content[i].quantity = req.body.quantity;
          continue; // Stop the loop
        }
      }

      if (alreadyOrdered) { // Since it was already in his cart before, just update that order's quantity
        if (req.body.quantity <= 0) {
          for (var idx = 0; idx < user.content.length; idx++) {
            if (user.content[idx].item.toString() === req.body.item._id.toString()) {
              user.content.splice(idx, 1);
              continue;
            }
          }
        }

        Cart.update({ user: req.user._id }, { content: user.content }, function (err4, cart) {
          if (err) { // Means a user hasn't added anything to his cart ever.
            return res.status(400).send({
              message: err4
            });
          } else {
            res.send({
              message: 'Updated your order\'s quantity'
            });
          }
        });
      } else {
        if (req.body.quantity < 1) {
          return res.status(400).send({
            message: 'Please input a valid quantity'
          });
        }

        Cart.update({ user: req.user._id }, { $push: { content: { item: req.body.item._id, quantity: req.body.quantity } } }, function (err3, cart) {
          if (err) { // Means a user hasn't added anything to his cart ever.
            return res.status(400).send({
              message: err3
            });
          } else {
            res.send({
              message: 'Successfully added to cart'
            });
          }
        });
      }
    }
  });

};

exports.viewCart = function (req, res) {
  
  Cart.findOne({ user: req.user._id }).lean().exec(function (err, cart) {
    if (err) {
      return res.status(400).send({
        message: 'Failed to load Cart'
      });
    } else if (!cart) {
      return res.status(400).send({
        message: 'Cart does not exist'
      });
    } else if (cart) {
      var itemIds = [];
      for (var i = 0; i < cart.content.length; i++) {
        itemIds.push(cart.content[i].item);
      }

      Item.find( { _id: { $in: itemIds } } ).exec(function (err, items) {
        if (err) {
          return res.status(400).send({
            message: 'Item not found'
          });
        }

        for (var j = 0; j < cart.content.length; j++) {
          for (var k = 0; k < items.length; k++) {
            if (cart.content[j].item.toString() === items[k]._id.toString()) {
              cart.content[j].itemInfo = items[k];
            }
          }
        }

        res.send(cart);
      
      });
    }

  });

};

exports.init = function () {
  paypal.configure({
    'host': 'api.sandbox.paypal.com',
    'port': '',
    'client_id': 'ATyYbJ3d4N-YauTExji9RlkJuF3-rzhAcDHAv0VraepSxpuWq0TBkZa6dxjgGC1hcRwQK5BorV14fItx',
    'client_secret': 'EKOUGLXGTHd6t5Xjk8S2l9ei5ultHi4jRPfNbLkeuuw4eY9nOqVnSRahnT3V9XHee43CB74V7O-aOeNt'
  });
};