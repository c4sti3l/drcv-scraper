// Field layouts extracted from drcv.de's LiveTiming-*.js bundle (const `r` and `a`).
// The server sends plain arrays; these maps turn them into named objects.

const INFO_FIELDS = [
  "timeofday",
  "racetime",
  "timetogo",
  "eventname",
  "trackname",
  "tracklength",
  "groupname",
  "runname",
  "runtype",
  "flag",
  "lapstogo",
  "laps",
  "leader",
  "leaderavgspeed",
  "leadermargin",
  "bestlaptime",
  "bestlapby",
];

const POS_FIELDS = [
  "sort",
  "marker",
  "position",
  "positioninclass",
  "nr",
  "transponder",
  "regnumber",
  "fullname",
  "club",
  "teamname",
  "club_123",
  "license_123",
  "driver_nr",
  "firstname1",
  "lastname1",
  "club1",
  "license1",
  "firstname2",
  "lastname2",
  "club2",
  "license2",
  "firstname3",
  "lastname3",
  "club3",
  "license3",
  "class",
  "laps",
  "difference",
  "gap",
  "lasttime",
  "secondlasttime",
  "thirdlasttime",
  "averagetime",
  "totaltime",
  "lastspeed",
  "averagespeed",
  "besttime",
  "bestspeed",
  "bestinlap",
  "secondbesttime",
  "secondbestspeed",
  "secondbestinlap",
  "nopitstops",
  "lastpitstop",
  "sincepit",
  "lasttimeofday",
  "lasttimeline",
];

function arrayToObject(arr, fieldNames) {
  const out = {};
  for (let i = 0; i < fieldNames.length; i++) {
    out[fieldNames[i]] = arr ? arr[i] : undefined;
  }
  return out;
}

function parseInfo(infoArr) {
  return arrayToObject(infoArr, INFO_FIELDS);
}

function parsePosRow(posArr) {
  return arrayToObject(posArr, POS_FIELDS);
}

module.exports = { INFO_FIELDS, POS_FIELDS, parseInfo, parsePosRow };
