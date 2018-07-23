# css-auto-prefix

### For use with _Visual Studio Code_

## Beta 0.2.0

This tool, although currently usable to an extent, is by no means completed and still requires a lot of work to be finalized. If this freaks you out, please stick around until a later, more stable version is released. Thanks!

# Functionality

The goal of this tool is to eliminate the time it takes to prefix all of your CSS attributes by doing it for you as you type. Keep in mind that it does reformat the CSS attributes which are already inside a block element, but this shouldn't be too noticeable in most cases.

![Demonstration](https://raw.githubusercontent.com/stevengeeky/css-auto-prefix/master/images/demonstration.gif)

Works both for indented and single-line CSS styles. To activate it, just `Ctrl+Shift+P` into the workbench command window and type "Auto Prefix"

## Requirements

No special requirements.

## Known Issues

* Ambiguous attributes will not be checked, and will not be automatically revised.

## Release Notes

### 0.2.0

Complete reimplementation for improved stability
* More intelligent pattern matching requires no semicolons to parse attribute values
* Attribute modification can take place regardless of css layout (i.e. your code won't get reformatted)

### 0.1.0

Release of first beta.