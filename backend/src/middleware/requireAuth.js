const authService = require('../services/authService');
const { AppError } = require('../utils/errors');

function requireAuth(req, res, next) {
  const header = req.header('Authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : null;
  if (!token) return next(new AppError('UNAUTHORIZED', 'Sign in required'));

  const user = authService.getUserForToken(token);
  if (!user) return next(new AppError('UNAUTHORIZED', 'Sign in required'));

  req.userId = user.id;
  req.user = user;
  next();
}

module.exports = requireAuth;
