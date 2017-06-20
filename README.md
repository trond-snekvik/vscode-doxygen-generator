# Doxygen Generator for C/C++ functions

Generate function doxygen snippets for C and C++ functions.

## Features

Generate a Doxygen snippet documenting a C or C++ function. Pressing `Alt+Q` (or running the `Doxygen: Generate` command) creates a snippet with tabstops for the description, each parameter and the return value if the function has any. 

![Basic usage](doc/basic_usage.gif)

If the function already has a documentation comment, the plugin will make the existing description a placeholder, and updates the parameter list.

![Editing existing documentation blocks](doc/editing.gif)

## Known Issues

- The format of the doxygen block is not configurable. It enforces direction on the parameters, `@` for tags and block comments. 
- Not tested properly for C++ scope-setting (`::`). 
- Missing support for other languages.

## Release Notes

Users appreciate release notes as you update your extension.

### 1.0.0

Initial release of ...

### 1.0.1

Fixed issue #.

### 1.1.0

Added features X, Y, and Z.

-----------------------------------------------------------------------------------------------------------

## Working with Markdown

**Note:** You can author your README using Visual Studio Code.  Here are some useful editor keyboard shortcuts:

* Split the editor (`Cmd+\` on OSX or `Ctrl+\` on Windows and Linux)
* Toggle preview (`Shift+CMD+V` on OSX or `Shift+Ctrl+V` on Windows and Linux)
* Press `Ctrl+Space` (Windows, Linux) or `Cmd+Space` (OSX) to see a list of Markdown snippets

### For more information

* [Visual Studio Code's Markdown Support](http://code.visualstudio.com/docs/languages/markdown)
* [Markdown Syntax Reference](https://help.github.com/articles/markdown-basics/)

**Enjoy!**