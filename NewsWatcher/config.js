// YOU MUST CHANGE MANY OF THESE VALUES TO WORK WITH YOUR OWN ACCOUNTS YOU HAVE SET UP
var config = {}
config.host = process.env.HOST || "https://newswatcherdbaccnt.documents.azure.com:443/";
config.authKey = process.env.AUTH_KEY || "+xKoYQmwqkVxM9Syuh9ldZVM4TFuKHbBU9Ru/Nrz35mzvSzIWhl/rlr/Mh27XQj9LCHulXpPEz2z9CNjLEyMJg==";
config.collectionSelfId = "dbs/vXLkSA==/colls/vXWkAAapnQA=/";
config.globalNewsStoriesDocumentSelfId = "dbs/vXLkSA==/colls/vXWkAAapnQA=/docs/vXUkANapeGADKLIAAAAAAA==/";
config.countSProcSelfId = "dbs/vXUkAA==/colls/vXUkANapeQA=/sprocs/vXUkANapeOPWAAMAHAAAgA==/";
config.collPath = "dbs/newswatcherdb/colls/newswatchercoll/docs/";
config.JWT_SECRET = "hjko78905";
config.FAROO_KEY = "HJKLyuioijh712398756";
config.MAX_SHARED_STORIES = 30;
config.MAX_COMMENTS = 30;
config.MAX_Q_RETRIES = 5;
config.MAX_FILTERS = 5;
config.MAX_FILTER_STORIES = 10;

module.exports = config;