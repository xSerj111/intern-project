/**
 * CSS-module stand-in for Jest: every class lookup resolves to its own name so
 * component tests can assert on class names without a bundler.
 */
const styles = new Proxy(
  {},
  {
    get: (_target, key) => (typeof key === 'string' ? key : undefined),
  },
);

export default styles;
