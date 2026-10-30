## 1.13.0

- Added local encoding and crypto tools, including UTF-8 conversions, byte arrays, Crockford Base32, hashes, HMAC and password-based AES-256-GCM
- Added validated conversion between JSON, YAML, XML, Properties, TOML and INI, with explicit errors for data that the target format cannot preserve
- Added commands to insert spaces between Chinese characters and English letters or digits in selections, current lines or the whole document
- Added local cURL conversion to 33 Postman language and HTTP client variants, with output in a new document
- Improved context-filter deduplication, CSV processing, command registration and macro completion performance
- Fixed empty filter results and macro save/delete completion and error feedback
- Added regression suites and packaged-extension tests in an isolated VS Code Windows profile

## 1.12.1

- Fixed
  - Changed behavior of open new document to never reuse an untitled document.

## 1.12.0

- New Features
  - Perform operation on entire line of cursor when there is no selection for convenience
    - Applies to the following commands:
    - `Split Lines`
    - `Split Lines After...`
    - `Split Lines Before...`
    - `JSON String As Text`
    - `Selection As JSON String`
    - `Encode / Decode ...`
- Fixed
  - README missing image

## 1.11.2

- Fixed
  - Command not found errors due to incompatibility introduced in vscode 1.58

## 1.11.1

- Fixed
  - `Sort Lines By Length` regression introduced in 1.8.0 broke this command.
  - `Filter lines as new document` fixed issue with adding surrounding lines
  - Removed experimental macros

## 1.11.0

- New Features
  - `Normalize Diacritical Marks` transforms accented characters to non-accented versions
  - `Rotate Forward Selections` rotates the order of the selections forward
  - `Rotate Backward Selections` rotates the order of the selections backward

## 1.10.0

- New Features
  - `Randomize Selections` replace selections with random order of selected text
  - `Reverse Selections` replace selections with reverse order of selected text
  - `Sort Selections` replace selections with sorted order of selected text
  - `Trim Selections` replace selections with trimmed selected text

## 1.9.0

- New Features
  - `Split Lines After...` splits lines after the delimeter while keeping the delimeter
  - `Split Lines Before...` splits lines before the delimeter while keeping the delimeter

## 1.8.0

- New Features
  - `Encode / Decode ...`
    - Encode Base64
    - Decode Base64
    - Encode URL Segment
    - Decode URL Segment
    - Encode x-www-form-urlencoded
    - Decode x-www-form-urlencoded
    - Hash MD5
  - `JSON String As Text` unescapes a JSON string to text
  - `Selection As JSON String` escape selection to single JSON string
  - `Split Lines` split lines using specified delimeter
  - `Join Lines` join lines using specified delimeter
  - `Select Highlights` make selections of all text highlighted in the editor
- Improved
  - sort - now uses natural sort algorithm

## 1.7.0

- Added `Randomize Lines`
- Added `Selection As JSON String`

## 1.6.0

- Added `Count Duplicate Lines As New Document` which will count the number of occurrences of each line
- Added `Trim Lines` which will trim beginning and ending of lines selected
- Improved `Align CSV` and `Compact CSV` to allow for specifying custom delimiter

## 1.5.0

- New Feature `Macro Scripts`
  - Write text editor macros as scripts
  - Currently this feature is Experimental - for reference <https://github.com/dakaraphi/vscode-extension-transformer/issues/13>

## 1.4.0

- Enhanced `Filter Lines As New Document` command
  - Realtime filtering as you type for smaller documents
  - Add contextual lines relative to filtered lines to output
- New document commands now create document title related to original instead of generic untitled
- Updated some command descriptions and titles
- Fixed bug in filtering commands which prevented filtering properly on selections

## 1.3.2

- Added `Lines As JSON` command which Converts each line to a JSON string.  Useful for easily creating snippet bodies from selected text

## 1.2.0

- Added `Select Lines` command which expands all current find match results or cursors to full line selections

## 1.1.0

- Changed `Align CSV` to preserve delimeter so that it can be used for round trip editing
- Added `Compact CSV` command so that aligned CSV can be restored to its compact format

## 1.0.2

- Added `Copy To New Document` command
- Changed regex filters to use case insensitve

## 1.0.0

- Initial release
