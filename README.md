
# TASKRAYSFDXHELPER
sfdx plugin for loading sample data to scratch org
## Install
```sh
git clone git@github.com:BracketLabs/TaskRaySFDXHelper.git
cd TaskRaySFDXHelper
npm install
```
## Usage
Add to sfdx as a plugin:
```sh
sfdx plugins:link .
```
Run plug in:
```sh
sfdx sampleData:import -u authedOrgAlias
```
