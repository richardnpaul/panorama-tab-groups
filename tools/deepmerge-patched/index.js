// Derived from deepmerge 4.3.1 (MIT, Copyright (c) 2012 James Halliday, Josh Duff, and other contributors),
// which has no release that fixes GHSA-gcqx-w48m-w2h4: a source or target that has an own `__proto__`
// property (as JSON.parse makes) set the prototype of the merged result. Here every property of the result
// is defined on it, so no key can reach its prototype. Not kept from deepmerge: the check for React
// elements and the support of engines without Symbol, which addons-linter has no use for.

const { toString } = Object.prototype;
const hasOwn = Object.prototype.hasOwnProperty;
const isEnumerable = Object.prototype.propertyIsEnumerable;

// The functions that call each other are given to one another through the options, which are made in deepmerge()

function isSpecial(value) {
  const tag = toString.call(value);
  return tag === '[object RegExp]' || tag === '[object Date]';
}

function isMergeableObject(value) {
  return value !== null && typeof value === 'object' && !isSpecial(value);
}

function emptyTarget(value) {
  return Array.isArray(value) ? [] : {};
}

function cloneUnlessOtherwiseSpecified(value, options) {
  return options.clone !== false && options.isMergeableObject(value)
    ? options.merge(emptyTarget(value), value, options)
    : value;
}

function defaultArrayMerge(target, source, options) {
  return target
    .concat(source)
    .map((element) => options.cloneUnlessOtherwiseSpecified(element, options));
}

function getMergeFunction(key, options) {
  if (!options.customMerge) {
    return options.merge;
  }
  const customMerge = options.customMerge(key);
  return typeof customMerge === 'function' ? customMerge : options.merge;
}

function getKeys(object) {
  return Object.keys(object).concat(
    Object.getOwnPropertySymbols(object).filter((symbol) =>
      isEnumerable.call(object, symbol),
    ),
  );
}

function propertyIsOnObject(object, property) {
  // `in` throws for what is not an object; such a thing has no property
  const isObject =
    (typeof object === 'object' && object !== null) ||
    typeof object === 'function';
  return isObject && property in object;
}

// A property that exists up the prototype chain of the target, or that cannot be enumerated, is not merged
function propertyIsUnsafe(target, key) {
  return (
    propertyIsOnObject(target, key) &&
    !(hasOwn.call(target, key) && isEnumerable.call(target, key))
  );
}

function put(destination, key, value) {
  Object.defineProperty(destination, key, {
    value,
    writable: true,
    enumerable: true,
    configurable: true,
  });
}

function mergeObject(target, source, options) {
  const destination = {};
  if (options.isMergeableObject(target)) {
    getKeys(target).forEach((key) => {
      put(
        destination,
        key,
        options.cloneUnlessOtherwiseSpecified(target[key], options),
      );
    });
  }
  getKeys(source).forEach((key) => {
    if (propertyIsUnsafe(target, key)) {
      return;
    }
    put(
      destination,
      key,
      propertyIsOnObject(target, key) && options.isMergeableObject(source[key])
        ? getMergeFunction(key, options)(target[key], source[key], options)
        : options.cloneUnlessOtherwiseSpecified(source[key], options),
    );
  });
  return destination;
}

function deepmerge(target, source, options) {
  const settings = {
    ...options,
    arrayMerge: options?.arrayMerge ?? defaultArrayMerge,
    isMergeableObject: options?.isMergeableObject ?? isMergeableObject,
    // For custom arrayMerge() implementations to use; the caller may not replace either
    cloneUnlessOtherwiseSpecified,
    merge: deepmerge,
  };

  const sourceIsArray = Array.isArray(source);
  if (sourceIsArray !== Array.isArray(target)) {
    return cloneUnlessOtherwiseSpecified(source, settings);
  }
  return sourceIsArray
    ? settings.arrayMerge(target, source, settings)
    : mergeObject(target, source, settings);
}

deepmerge.all = function all(array, options) {
  if (!Array.isArray(array)) {
    throw new Error('first argument should be an array');
  }
  return array.reduce(
    (previous, next) => deepmerge(previous, next, options),
    {},
  );
};

export default deepmerge;
