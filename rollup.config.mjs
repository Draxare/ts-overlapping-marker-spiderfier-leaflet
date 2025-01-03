export default {
    input: 'dist/index.js',
    output: [
        {
            format: 'umd',
            file: 'dist/index.umd.js',
            name: 'omsleaflet',
            sourcemap: true
        },
        {
            format: 'cjs',
            file: 'dist/index.cjs.js',
            sourcemap: true
        },
        {
            format: 'amd',
            file: 'dist/index.amd.js',
            sourcemap: true
        },
        {
            format: 'iife',
            file: 'dist/index.browser.js',
            name: 'omsleaflet',
            sourcemap: true
        }
    ],
    context: 'window'
}