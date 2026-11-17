const sheets = require('./sheets');

function withCoopSource(options) {
  if (typeof options === 'string') return options;
  return { ...options, source: options?.source || 'coop' };
}

module.exports = {
  ...sheets,
  getData: (range, options) => sheets.getData(range, withCoopSource(options)),
  appendData: (range, values, options) => sheets.appendData(range, values, withCoopSource(options)),
  updateData: (range, values, options) => sheets.updateData(range, values, withCoopSource(options)),
  addSheetIfMissing: (title, options) => sheets.addSheetIfMissing(title, withCoopSource(options))
};
