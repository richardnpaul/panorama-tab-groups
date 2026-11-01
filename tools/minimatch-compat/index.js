// minimatch before 11.0.1 is flagged by GHSA-g3hv-75wg-m249 (attacker-controlled patterns can make
// firstPhasePreProcess() grow without bound), and nothing that depends on it accepts 11 yet. Old consumers
// (eslint 9, multimatch 6) use it as `require('minimatch')(...)` or `import minimatch from 'minimatch'`; newer
// ones (Stryker) use the named exports. This module is both, around the patched release.

const upstream = require('minimatch-upstream');

const { minimatch } = upstream;

module.exports = minimatch;
module.exports.minimatch = minimatch;
module.exports.Minimatch = upstream.Minimatch;
module.exports.GLOBSTAR = upstream.GLOBSTAR;
module.exports.sep = upstream.sep;
module.exports.filter = upstream.filter;
module.exports.match = upstream.match;
module.exports.braceExpand = upstream.braceExpand;
module.exports.defaults = upstream.defaults;
module.exports.escape = upstream.escape;
module.exports.unescape = upstream.unescape;
