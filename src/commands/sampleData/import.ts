import { core, flags, SfdxCommand } from "@salesforce/command";
import * as moment from "moment";
const { StringStream } = require("scramjet");
const request = require("request");
const cacheSpoilString = "?s=" + new Date().getTime();
const files = {
  TASKRAY__Project__c:
    "https://s3.amazonaws.com/blstatic/sdo_data/Projects.csv" +
    cacheSpoilString,
  TASKRAY__trTaskGroup__c:
    "https://s3.amazonaws.com/blstatic/sdo_data/TaskGroups.csv" +
    cacheSpoilString,
  TASKRAY__Project_Task__c:
    "https://s3.amazonaws.com/blstatic/sdo_data/Tasks.csv" + cacheSpoilString,
  TASKRAY__trChecklistGroup__c:
    "https://s3.amazonaws.com/blstatic/sdo_data/ChecklistGroups.csv" +
    cacheSpoilString,
  TASKRAY__trChecklistItem__c:
    "https://s3.amazonaws.com/blstatic/sdo_data/ChecklistItems.csv" +
    cacheSpoilString,
  TASKRAY__trTaskTime__c:
    "https://s3.amazonaws.com/blstatic/sdo_data/TimeEntries.csv" +
    cacheSpoilString,
  TASKRAY__trDependency__c:
    "https://s3.amazonaws.com/blstatic/sdo_data/Dependencies.csv" +
    cacheSpoilString
};

let variableNameToSFIdMapping = {};
let conn = null;
let currentUserId = "";
let trUnassignedQueueId = "";
// Initialize Messages with the current plugin directory
core.Messages.importMessagesDirectory(__dirname);

// Load the specific messages for this file. Messages from @salesforce/command, @salesforce/core,
// or any library that is using the messages framework can also be loaded this way.
const messages = core.Messages.loadMessages("TaskRaySFDXHelper", "org");

interface ResolvedObjectMap {
  objDataToInsert: Array<Object>;
  objDataToInsertLater: Array<Object>;
}

interface SampleDataMap {
  objectName: string;
  data: Array<Object>;
}

export default class Import extends SfdxCommand {
  public static description = messages.getMessage("commandDescription");

  public static examples = [
    `$ sfdx hello:org --targetusername myOrg@example.com --targetdevhubusername devhub@org.com
  Hello world! This is org: MyOrg and I will be around until Tue Mar 20 2018!
  My hub org id is: 00Dxx000000001234
  `,
    `$ sfdx hello:org --name myname --targetusername myOrg@example.com
  Hello myname! This is org: MyOrg and I will be around until Tue Mar 20 2018!
  `
  ];

  public static args = [{ name: "file" }];

  protected static flagsConfig = {
    // flag with a value (-n, --name=VALUE)
    name: flags.string({
      char: "n",
      description: messages.getMessage("nameFlagDescription")
    }),
    force: flags.boolean({
      char: "f",
      description: messages.getMessage("forceFlagDescription")
    })
  };

  // Comment this out if your command does not require an org username
  protected static requiresUsername = true;

  // Comment this out if your command does not support a hub org username
  protected static supportsDevhubUsername = true;

  // Set this to true if your command requires a project workspace; 'requiresProject' is false by default
  protected static requiresProject = false;

  private async getFiles(): Promise<{}> {
    return Promise.all(
      Object.keys(files).map(objectName => {
        const fileURL = files[objectName];
        return new Promise((resolve, reject) => {
          var data = [];
          request
            .get(fileURL) // fetch csv
            .pipe(new StringStream("utf-8")) // pass to stream
            .CSVParse({ header: true }) // parse into objects
            .consume(object => data.push(object)) // do whatever you like with the objects
            .then(() => {
              resolve({ objectName, data });
            });
        });
      })
    );
  }

  private async parseAndInsertSampleData(
    sampleData: Array<SampleDataMap>
  ): Promise<{}> {
    return new Promise(async (resolve, reject) => {
      try {
        //sampleData.forEach(async sampleDataObj => {
        for (const sampleDataObj of sampleData) {
          console.log(
            "Inserting " +
              sampleDataObj.data.length +
              " " +
              sampleDataObj.objectName
          );
          await this.parseAndInsertObject(sampleDataObj);
        }
        //});
        resolve();
      } catch (e) {
        console.error(e);
        reject(e);
      }
    });
  }

  private async parseAndInsertObject(
    sampleDataObj: SampleDataMap
  ): Promise<{}> {
    return new Promise(async (resolve, reject) => {
      let dataToInsert = true;
      let dataArr = sampleDataObj;
      let i = 0;
      while (dataToInsert === true && i < 10) {
        let parsedObjects = this.resolveVariablesForObject(dataArr);
        if (parsedObjects.objDataToInsert) {
          try {
            const results = await conn
              .sobject(sampleDataObj.objectName)
              .create(parsedObjects.objDataToInsert);
            results.forEach((resultObj, index) => {
              if (resultObj.success) {
                const oldId = parsedObjects.objDataToInsert[index]["Id"];
                const newId = resultObj.id;
                variableNameToSFIdMapping[oldId] = newId;
              }
            });
          } catch (e) {
            console.log(e);
          }
        }

        if (parsedObjects.objDataToInsertLater.length === 0) {
          dataToInsert = false;
        }
        if (parsedObjects.objDataToInsertLater) {
          dataArr = {
            objectName: sampleDataObj.objectName,
            data: parsedObjects.objDataToInsertLater
          };
        }
        i++;
      }
      console.log("completed insert for " + sampleDataObj.objectName);
      resolve();
    });
  }

  private resolveVariablesForObject(
    sampleDataObj: SampleDataMap
  ): ResolvedObjectMap {
    let objDataToInsert = [];
    let objDataToInsertLater = [];
    const objectName = sampleDataObj.objectName;
    console.log(sampleDataObj.objectName, variableNameToSFIdMapping);
    sampleDataObj.data.forEach(origRecord => {
      let record = Object.assign({}, origRecord);
      let addThisRecord = true;
      Object.keys(record).forEach((fieldName: string) => {
        let value = record[fieldName];
        //If the field is empty, delete the fieldName, else we receive invalid type when sending to server
        if (
          value === "" ||
          fieldName === "TASKRAY__Dependent_Update_Pending__c" ||
          fieldName === "TASKRAY__trTemplateSource__c"
        ) {
          delete record[fieldName];
          value = record[fieldName];
        }

        if (value === "FALSE") {
          record[fieldName] = false;
          value = record[fieldName];
        }

        if (value === "TRUE") {
          record[fieldName] = true;
          value = record[fieldName];
        }

        //If we are trying to set a $User field but there is no $User match, set the field to the current user's id
        if (
          typeof value === "string" &&
          value.indexOf("$User: ") === 0 &&
          !variableNameToSFIdMapping[value]
        ) {
          record[fieldName] = currentUserId;
          value = record[fieldName];
        }

        //If the we are trying to populate an account or opp field but we don't have a resolution match, delete the field
        if (
          typeof value === "string" &&
          (value.indexOf("$Opp: ") === 0 ||
            value.indexOf("$Account: ") === 0) &&
          !variableNameToSFIdMapping[value]
        ) {
          delete record[fieldName];
          value = record[fieldName];
        }

        //If we have a dynamic variable id set, populate it
        if (
          typeof value === "string" &&
          value.substring(0, 1) === "$" &&
          variableNameToSFIdMapping[value]
        ) {
          record[fieldName] = variableNameToSFIdMapping[value];
          //If we're on a checklist item and a group is assigned to owner, set it to empty
          if (
            objectName === "TASKRAY__trChecklistItem__c" &&
            fieldName === "TASKRAY__trOwner__c" &&
            variableNameToSFIdMapping[value] &&
            variableNameToSFIdMapping[value].indexOf("00G") === 0
          ) {
            delete record[fieldName];
            value = record[fieldName];
          }
        } else if (
          typeof value === "string" &&
          value.substring(0, 1) === "$" &&
          value.substring(0, 3) !== "$T+" &&
          value.substring(0, 3) !== "$T-" &&
          value !== "$TODAY" &&
          fieldName !== "Id" &&
          value !== "$Burlington"
        ) {
          //its a string, it's prefix is $, but not $T and it's not the row Id field
          //(in the original, we had deleted the id field at the begining of loop, but now we need to save it on the objectsToBeInsertedLater)
          //console.log("NOT ADDING", fieldName, value);
          addThisRecord = false;
        }

        //If the field is a date we have some handling to do
        if (this.isDateField(fieldName)) {
          //If we are doing a dynamic time getter, apply it
          if (
            typeof value === "string" &&
            (value.substring(0, 3) === "$T+" ||
              value.substring(0, 3) === "$T-" ||
              value === "$TODAY")
          ) {
            record[fieldName] = this.dynamicDateGetters(value);
          } else if (
            typeof value === "string" &&
            value.split("-").length == 3
          ) {
            record[fieldName] = moment.utc(value, "YYYY-MM-DD").valueOf();
            value = record[fieldName];
          }
        }
      });
      if (addThisRecord === true) {
        //add this id to list to be resolved after the objects insert
        //Clear out the ID since we don't have it and have already mapped it
        //delete record["Id"];
        //console.log(record);
        objDataToInsert.push(record);
      } else {
        //we do not want to strip the id from objects that we are not inserting yet
        //console.log("do not add", record);
        objDataToInsertLater.push(record);
      }
    });
    return {
      objDataToInsert: objDataToInsert,
      objDataToInsertLater: objDataToInsertLater
    };
  }

  private dynamicDateGetters(dateString: string): number {
    if (dateString === "$TODAY") {
      return moment
        .utc()
        .startOf("day")
        .valueOf();
    } else if (dateString.substring(0, 3) === "$T+") {
      var integer = parseInt(dateString.substring(3));
      return moment
        .utc()
        .startOf("day")
        .add(integer, "days")
        .valueOf();
    } else if (dateString.substring(0, 3) === "$T-") {
      var integer = parseInt(dateString.substring(3));
      return moment
        .utc()
        .startOf("day")
        .subtract(integer, "days")
        .valueOf();
    }
  }

  private isDateField(fieldName: string): Boolean {
    if (
      fieldName === "TASKRAY__trEndDate__c" ||
      fieldName === "TASKRAY__trStartDate__c" ||
      fieldName === "TASKRAY__Deadline__c" ||
      fieldName === "TASKRAY__Project_Start__c" ||
      fieldName === "TASKRAY__Project_End__c" ||
      fieldName === "TASKRAY__Date__c"
    ) {
      return true;
    }
    return false;
  }

  public async run(): Promise<core.AnyJson> {
    conn = this.org.getConnection();
    //INcreasing the number of requests we can make so all the creates work
    conn.maxRequest = 5000;
    const identity = await conn.identity();
    currentUserId = identity.user_id;
    const unassignedQueue = await conn.query(
      "SELECT Id,Name FROM Group WHERE Type = 'Queue' AND DeveloperName = 'trUnassigned'"
    );
    if (unassignedQueue.totalSize > 0) {
      trUnassignedQueueId = unassignedQueue.records[0].Id;
    }
    let sampleData;
    try {
      sampleData = await this.getFiles();
    } catch (e) {
      console.error(e);
    }
    try {
      await this.parseAndInsertSampleData(sampleData);
    } catch (e) {
      console.log(e);
    }

    return { orgId: this.org.getOrgId(), outputString: "" };
  }
}
