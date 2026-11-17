const helpers = require('./helpers');

function cachedGetData(range, options = {}) {
  const optionsWithSource = typeof options === 'number'
    ? { ttlMs: options, source: 'coop' }
    : { ...options, source: options?.source || 'coop' };
  return helpers.cachedGetData(range, optionsWithSource);
}

module.exports = { ...helpers, cachedGetData };
