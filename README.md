
# TASKRAYSFDXHELPER
sfdx plugin for loading sample data to scratch org
## Install
```sh
git clone git@github.com:BracketLabs/TaskRaySFDXHelper.git
cd TaskRaySFDXHelper
npm install
#add plugin to sfdx
sfdx plugins:link .
```
## Usage

Run plug in:
```sh
sfdx sampleData:import -u authedOrgAlias
```
