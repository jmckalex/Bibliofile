-- BibDesk automation via the x-bibdesk:// URL scheme.
-- These are fire-and-forget COMMANDS to a running BibDesk. (A native helper app
-- — see docs/automation — will add a real AppleScript dictionary with queries.)

-- 1) Open a library file.
open location "x-bibdesk://open?file=/Users/me/refs.bib"

-- 2) Import a DOI into the open library (looked up via CrossRef).
open location "x-bibdesk://import?doi=10.1023/A:1005239929271"

-- 3) Add a new entry from explicit fields (values percent-encoded).
open location "x-bibdesk://new?type=article&Title=On%20Bullshit&Author=Harry%20Frankfurt&Year=2005"

-- 4) Import a full BibTeX record. URL-encode it first (here via python3).
on urlencode(theText)
	return do shell script "/usr/bin/python3 -c 'import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1]))' " & quoted form of theText
end urlencode

set theBib to "@article{frankfurt2005, Author = {Harry Frankfurt}, Title = {On Bullshit}, Year = {2005}}"
open location ("x-bibdesk://import?bibtex=" & my urlencode(theBib))

-- Equivalent from a shell, if you prefer:
--   do shell script "open 'x-bibdesk://import?doi=10.1126/science.1058040'"
