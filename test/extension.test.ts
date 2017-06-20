//
// Note: This example test is leveraging the Mocha test framework.
// Please refer to their documentation on https://mochajs.org/ for help.
//

// The module 'assert' provides assertion methods from node
import * as assert from 'assert';

// You can import and use all API from the 'vscode' module
// as well as import your extension to test it
import * as vscode from 'vscode';
import * as myExtension from '../src/extension';

function funcTest(funcName, returns, params, src) {
    var expected = new myExtension.FunctionDefinition(funcName, returns, params);
    var actual = myExtension.getFunction(src);
    assert.ok(actual);
    assert.equal(expected.name, actual.name);
    assert.equal(expected.returns, actual.returns);
    
    assert.equal(expected.parameters.length, params.length);
    for (var i = 0; i < expected.parameters.length; i++) {
        assert.equal(expected.parameters[i].name, params[i].name);
        assert.equal(expected.parameters[i].type, params[i].type);
    }
}

class DoxyTestParam { name: string; direction: string; description: string}

function doxTest(desc: string, params: DoxyTestParam[], returns: string[], src: string) {
    var expected = new myExtension.FunctionDefinition('', returns.length > 0);
    expected.description = desc;
    var actual = myExtension.getFunctionFromDoxygen(src);

    assert.ok(actual);
    assert.equal('', actual.name);
    assert.equal(returns.length > 0, actual.returns);
    assert.equal(desc, actual.description);
    assert.equal(params.length, actual.parameters.length);
    for (var i = 0; i < params.length; i++) {
        assert.equal(actual.parameters[i].name, params[i].name);
        assert.equal(actual.parameters[i].description, params[i].description);
        assert.equal(actual.parameters[i].direction, params[i].direction);
    }

    assert.equal(returns.length, actual.returnDescriptions.length);
    for (var i = 0; i < returns.length; i++) {
        assert.equal(returns[i], actual.returnDescriptions[i]);
    }
}

// Defines a Mocha test suite to group tests of similar kind together
suite("Extension Tests", () => {

    test("Function getter", () => {
        funcTest("funcName", false, [], "void funcName();");
        funcTest("funcName", false, [], "static void funcName();");
        funcTest("funcName", true, [], "void * funcName();");
        funcTest("funcName", true, [], "void *funcName();");
        funcTest("funcName", true, [], "void **funcName();");
        funcTest("funcName", true, [], "void* funcName();");
        funcTest("funcName", true, [], "rettype funcName();");
        funcTest("funcName", true, [], "static const * const rettype ** funcName();");
        funcTest("funcName", true, [], "ret funcName(void);");
        funcTest("funcName", true, [{name: 'a', type: 'int'}], "ret funcName(int a);");
        funcTest("funcName", true, [{name: 'a', type: 'int'}, {name: 'b', type: 'float'}], "ret funcName(int a, float b);");
        funcTest("_funcName123", false, [], "void _funcName123();");
        funcTest("funcName", true, [], "_ret funcName();");
        funcTest("funcName", true, [], " _ret funcName();");
        funcTest("funcName", false, [], " void funcName();");
        funcTest("funcName", true, [], "_ret funcName( );");
        funcTest("funcName", true, [], "_ret funcName()");
        funcTest("funcName", true, [{name: 'a', type: 'int'}], "_ret funcName(int a )");
        funcTest("funcName", true, [{name: 'a', type: 'int'}, {name: 'b', type: 'float'}], "ret funcName(int a,\nfloat b);");
        funcTest("funcName", true, [{name: 'a', type: 'int'}, {name: 'b', type: 'float'}], "\nret\nfuncName\n(\nint\na\n,\nfloat\nb\n)\n;");
        funcTest("funcName", true, [{name: 'a', type: 'const int'}, {name: 'b', type: 'const float *'}], "ret funcName(const int a,const float * b);");
        funcTest("funcName", true, [{name: 'a', type: 'int *'}], "ret funcName(int *a);");
    });

    test("Snippet generator", () => {
        let func = new myExtension.FunctionDefinition('funcName', false, [new myExtension.FunctionParameter('a', 'const int'), new myExtension.FunctionParameter('b', 'const float *')]);
        assert.equal(myExtension.generateSnippet(func).value, 
`/**
 * $1
 *
 * @param[in] a $2
 * @param[in] b $3
 */
`);
        func = new myExtension.FunctionDefinition('funcName', true, [new myExtension.FunctionParameter('a', 'int *')]);
        assert.equal(myExtension.generateSnippet(func).value, 
`/**
 * $1
 *
 * @param[in,out] a $2
 *
 * @returns $3
 */
`);
        func = new myExtension.FunctionDefinition('funcName', true, []);
        assert.equal(myExtension.generateSnippet(func).value, 
`/**
 * $1
 *
 * @returns $2
 */
`);
        func = new myExtension.FunctionDefinition('funcName', false, []);
        assert.equal(myExtension.generateSnippet(func).value, 
`/**
 * $1
 */
`);
    });

    test('Doxygen parsing', () => {
       doxTest('A function description.', [{name: 'a', direction: 'dir', description: 'A function parameter.'}], ['retval hello', 'returns a function return description', 'return'],
`/**
 * A function description.
 *
 * @param[dir] a A function parameter.
 * 
 * @retval hello
 * @returns a function return description
 * 
 * @return
 */`);
        doxTest('A function description.', [{name: 'a', direction: 'dir', description: 'A function parameter.'}, {name: 'b', direction: 'dir', description: 'Another function parameter.'}], 
                [],
`/**
 * A 
 * function 
 * description.
 * 
 * @param[dir] a A function parameter.
 * @param[dir] b Another 
 *          function 
 * parameter.
 */`);
    });
        doxTest('A function description.', [], 
                [],
`/**
 * A 
 * function 
 * description.
 */`);
        doxTest('', [], 
                [],
`/**
 */`);
        doxTest('', [{name: 'a', direction: 'dir', description: 'A function parameter.'}], 
                [],
`/**
 * @param[dir] a A function parameter.
 */`);
        doxTest('', [], 
                ['retval hello'],
`/**
 * @retval hello
 */`);
});