import * as functions from 'firebase-functions';
import { getAccessToken, getUserInfo, revokeRefreshToken, testRefreshToken, getSubreddits } from './helpers';
import * as admin from 'firebase-admin';

admin.initializeApp();
const firestore = admin.firestore();
const database = admin.database();

interface submitUserLogin_i {
    code: string;
    testing: boolean;
}

interface saveBlacklist_i {
    accessToken: string;
    blacklist: any;
}

interface saveExclusionList_i {
    accessToken: string;
    exclusionList: string[];
}

exports.submitUserLogin = functions.https.onCall(async (data: submitUserLogin_i) => {
    return new Promise(async (res, rej) => {
        let accessToken: string;
        let refreshToken: string;
        let userInfo: any;
        let resp: any;
        let subreddits: string[] = [];
        let exclusionList: string[] = [];

        const clientid = functions.config().reddit[data.testing ? 'test_clientid' : 'clientid'];
        const secret = functions.config().reddit[data.testing ? 'test_secret' : 'secret'];

        console.log('GETTING TOKEN(S)');
        try {
            ({ refreshToken, accessToken } = await getAccessToken(data.code, clientid, secret, data.testing));
        } catch(err) {
            console.error('FAILED GETTING ACCESS TOKEN AND REFRESH TOKEN', err.response.data);
            res({ ok: false, message: 'Access token retrieval failed. Error code: ' + err.response.status });
            return;
        }
        console.log(accessToken);
        console.log(refreshToken);
        if (!accessToken && !refreshToken) {
            console.error('ACCESS TOKEN AND REFRESH TOKEN ARE UNDEFINED');
            res({ ok: false, message: 'User token retrieval failed' });
            return;
        }

        console.log('GETTING USERNAME');
        try {
            userInfo = await getUserInfo(accessToken);
        } catch(err) {
            console.error('[Submit] FAILED GETTING USER INFO', err.response.data);
            await firestore.collection('unnamed tokens').doc(new Date().getTime().toString()).set({
                    error: err.response.data,
                    refreshToken
                });
            res({ ok: true, message: 'success' });
            return;
        }
        const USERNAME = userInfo.name;
        console.log(USERNAME);

        firestore.collection('users').doc(USERNAME).get()
            .then(async (doc) => {
                if (!doc.exists) {
                    console.log('User has not yet signed up, will write to db');
                } else {
                    const docData = doc.data();
                    let savedRefreshToken;
                    if (docData) {
                        savedRefreshToken = docData['refreshToken'];
                        if (!savedRefreshToken) {
                            console.log('Cannot retrieve document refresh token; no refresh token');
                        } else {
                            console.log('Current refresh token: ' + savedRefreshToken);
                            console.log('CHECKING IF CURRENT REFRESH TOKEN IS VALID');
                            try {
                                resp = await testRefreshToken(savedRefreshToken, clientid, secret);
                            } catch (err) {
                                if (err.response.status != 400) {
                                    console.error('FAILED TO TEST CURRENT REFRESH TOKEN', err.response.data);
                                    res({ ok: false, message: 'Failed to test current refresh token: Error code: ' + err.response.status });
                                    return;
                                } else {
                                    console.log(JSON.stringify(err));
                                    console.log('Received bad request error when testing current refresh token');
                                    resp = { access_token: null };
                                }
                            }
                            console.log(JSON.stringify(resp));
                            if (!resp['access_token']) {
                                console.log('SAVED REFRESH TOKEN IS INVALID, REVOKING');
                                try {
                                    resp = await revokeRefreshToken(savedRefreshToken, clientid, secret);
                                } catch(err) {
                                    if (err.response.status != 400) {
                                        console.error('FAILED REVOKING SAVED REFRESH TOKEN', err.response.data);
                                        res({ ok: false, message: 'Revoking of saved refresh token failed. Error code: ' + err.response.status });
                                        return;
                                    } else {
                                        console.log(JSON.stringify(err));
                                        console.log('Received bad request error when revoking current refresh token');
                                    }
                                }
                                console.log(JSON.stringify(resp));
                            } else {
                                console.log('SAVED REFRESH TOKEN IS VALID');
                                console.log('REVOKING CURRENT REFRESH TOKEN');
                                try {
                                    await revokeRefreshToken(refreshToken, clientid, secret);
                                } catch(err) {
                                    console.error('FAILED REVOKING CURRENT REFRESH TOKEN', err.response.data);
                                    res({ ok: false, message: 'Revoking of current refresh token failed. Error code: ' + err.response.status });
                                    return;
                                }

                                refreshToken = savedRefreshToken
                                accessToken = (await testRefreshToken(refreshToken, clientid, secret))['access_token'];
                            }
                        }
                    } else {
                        console.log('Cannot retrieve document data; data empty');
                    }
                }

                console.log('GETTING USER SUBREDDITS');
                    try {
                        subreddits = await getSubreddits(accessToken);
                    } catch(err) {
                        console.error(err);
                        console.error('FAILED TO GET USER SUBREDDITS', err.response.data);
                        res({ ok: false, message: 'Getting user subreddits failed. Error code: ' + err.response.status });
                        return;
                    }

                console.log('GETTING USER EXCLUSION LIST');
                firestore.collection('exclusion lists').doc(USERNAME).get()
                    .then(async (doc) => {
                        if (!doc.exists) {
                            console.log('USER HAS NO EXCLUSION LIST. RETURNING EMPTY');
                        } else {
                            const docData = doc.data();
                            if (docData) {
                                console.log('RETURNING EXISTING EXCLUSION LIST');
                                exclusionList = docData['subreddits'];
                                console.log(JSON.stringify(exclusionList));
                            } else {
                                console.log('USER HAS EMPTY EXCLUSION LIST. RETURNING EMPTY');
                            }

                            console.log('ADDING TO FIRESTORE DB');
                            await firestore.collection('users').doc(USERNAME).set({
                                timestamp: new Date().getTime(),
                                refreshToken,
                            });

                            res({ ok: true, message: 'success', accessToken, subreddits, exclusionList });
                            return;
                        }
                    }).catch(err => {
                        console.error('Error getting user document', err);
                        res({ ok: false, message: 'db read failure'});
                        return;
                    });
            }).catch(err => {
                console.error(err)
                console.error('Submit: Error getting user document', JSON.stringify(err));
                res({ ok: false, message: 'db read failure' });
                return;
            });
    });
});

exports.deleteUserInfo = functions.https.onCall(async (data: submitUserLogin_i) => {
    return new Promise(async (res, rej) => {
        let accessToken: string;
        let resp: any;
        let userInfo;

        const clientid = functions.config().reddit[data.testing ? 'test_clientid' : 'clientid'];
        const secret = functions.config().reddit[data.testing ? 'test_secret' : 'secret'];

        console.log('DELETING USER INFO');
        console.log('GETTING ACCESS TOKEN');
        try {
            ({ accessToken } = await getAccessToken(data.code, clientid, secret, data.testing));
        } catch(err) {
            console.error('FAILED GETTING ACCESS TOKEN', err.response.data);
            res({ ok: false, message: 'Access token retrieval failed. Error code: ' + err.response.status });
            return;
        }
        console.log(accessToken);

        if (!accessToken) {
            console.error('ACCESS TOKEN IS UNDEFINED');
            res({ ok: false, message: 'User token retrieval failed' });
            return;
        }
        console.log('GETTING USERNAME');
        try {
            userInfo = await getUserInfo(accessToken);
        } catch(err) {
            console.error('[Delete] FAILED GETTING USER INFO', err.response.data);
            res({ ok: false, message: 'Retrieval of user identity info failed. Error code: ' + err.response.status });
            return;
        }

        const USERNAME = userInfo.name;
        console.log(USERNAME);

        console.log('GETTING USER CURRENT REFRESH TOKEN');
        firestore.collection('users').doc(USERNAME).get()
            .then(async (doc) => {
                if (!doc.exists) {
                    console.log('Cannot retrieve document; no such document');
                    await firestore.collection('empty deletes').doc(USERNAME).set({
                        timestamp: new Date().getTime(),
                    });
                } else {
                    const docData = doc.data();
                    let refreshToken;
                    if (docData) {
                        refreshToken = docData['refreshToken'];
                        if (!refreshToken) {
                            console.log('Error getting document refresh token; no refresh token');
                        } else {
                            console.log(refreshToken);
                        }
                    } else {
                        console.log('Cannot retrieve document data; data empty');
                    }

                    if (refreshToken) {
                        console.log('REVOKING PERMANENT REFRESH TOKEN');
                        try {
                            resp = await revokeRefreshToken(refreshToken, clientid, secret);
                        } catch(err) {
                            if (err.response.status != 400) {
                                console.error('FAILED REVOKING REFRESH TOKEN', err.response.data);
                                res({ ok: false, message: 'Revoking of refresh token failed. Error code: ' + err.response.status });
                                return;
                            }
                        }
                        console.log(JSON.stringify(resp));
                    }

                    console.log('DELETING USER FROM FIRESTORE DB');
                    await firestore.collection('users').doc(USERNAME).delete();
                    console.log('DELETING USER BLACKLIST');
                    await firestore.collection('blacklists').doc(USERNAME).delete();
                    console.log('DELETING USER EXCLUSION LIST');
                    await firestore.collection('exclusion lists').doc(USERNAME).delete();
                }

                res({ ok: true, message: 'success' });
            }).catch(err => {
              console.error('Delete: Error getting user document', JSON.stringify(err));
              res({ ok: false, message: 'db read failure'});
            });
    });
});

exports.documentWriteListener = functions.firestore.document('users/{documentUid}').onWrite((change, context) => {
    return new Promise(async (res, rej) => {
        if (!change.before.exists) {
            console.log('INCREMENTING SIGNUP COUNTER');
            database.ref('signup_count').transaction(function (current_value: any) {
                return (current_value || 0) + 1;
            });
        } else if (!change.after.exists) {
            console.log('DECREMENTING SIGNUP COUNTER');
            database.ref('signup_count').transaction(function (current_value: any) {
                return (current_value || 0) - 1;
            });
        }
        res({ ok: true });
    });
});

exports.getTokenAndBlacklist = functions.https.onCall(async (data) => {
    return new Promise(async (res, rej) => {
        let accessToken: string;
        let userInfo: any;

        const clientid = functions.config().reddit[data.testing ? 'test_clientid' : 'clientid'];
        const secret = functions.config().reddit[data.testing ? 'test_secret' : 'secret'];

        try {
            ({ accessToken } = await getAccessToken(data['code'], clientid, secret, data.testing));
        } catch(err) {
            console.error('FAILED GETTING ACCESS TOKEN', err.response.data);
            res({ ok: false, message: 'Access token retrieval failed. Error code: ' + err.response.status });
            return;
        }

        if (!accessToken) {
            console.error('ACCESS TOKEN IS UNDEFINED');
            res({ ok: false, message: 'User token retrieval failed' });
            return;
        }

        console.log('GETTING USERNAME');
        try {
            userInfo = await getUserInfo(accessToken);
        } catch(err) {
            console.error('FAILED GETTING USER INFO', err.response.data);
            res({ ok: false, message: 'Retrieval of user identity info failed. Error code: ' + err.response.status });
            return;
        }
        const USERNAME = userInfo.name;
        console.log(USERNAME);
        let blacklist: string[] = [];

        console.log('GETTING BLACKLIST FROM FIRESTORE');
        firestore.collection('blacklists').doc(USERNAME).get()
            .then(async (doc) => {
                if (!doc.exists) {
                    console.log('USER HAS NO BLACKLIST ENTRY. RETURNING EMPTY');
                } else {
                    const docData = doc.data();
                    if (docData) {
                        console.log('RETURNING EXISTING BLACKLIST');
                        blacklist = docData['blacklist'];
                        console.log(blacklist);
                    } else {
                        console.log('USER HAS EMPTY BLACKLIST. RETURNING EMPTY');
                    }
                }
                res({ ok: true, accessToken: accessToken, username: userInfo.name, blacklist: blacklist });
                return;
            }).catch(err => {
                console.error('Error getting user document', err);
                res({ ok: false, message: 'db read failure'});
                return;
            });
    });
});

exports.saveBlacklist = functions.https.onCall(async (data: saveBlacklist_i) => {
    return new Promise(async (res, rej) => {
        const accessToken = data.accessToken;
        const newBlacklist = data.blacklist[0];
        let userInfo;
        console.log(JSON.stringify(newBlacklist));

        if (!accessToken) {
            console.error('ACCESS TOKEN IS UNDEFINED');
            res({ ok: false, message: 'Problem with data' });
            return;
        }
        console.log(accessToken);

        console.log('GETTING USERNAME');
        try {
            userInfo = await getUserInfo(accessToken);
        } catch(err) {
            console.error('FAILED GETTING USER INFO', err.response.data);
            res({ ok: false, message: 'Authentication information sent was invalid. Has your session lasted longer than an hour? Error code: ' + err.response.status });
            return;
        }
        const USERNAME = userInfo.name;
        console.log(USERNAME);

        if (newBlacklist.length == 0 || newBlacklist.length == 1 && newBlacklist[0] == '') {
            console.log('REMOVING USER BLACKLIST');
            await firestore.collection('blacklists').doc(USERNAME).delete();
        } else {
            console.log('WRITING BLACKLIST TO DB');
            await firestore.collection('blacklists').doc(USERNAME).set({
                timestamp: new Date().getTime(),
                blacklist: newBlacklist,
            });
        }
        
        res({ ok: true, message: 'success' });
        return;
    });
});

exports.saveExclusionList = functions.https.onCall( async (data: saveExclusionList_i) => {
    return new Promise(async (res, rej) => {
        const accessToken = data.accessToken;
        const exclusionList = data.exclusionList;
        let userInfo: any;

        if (!accessToken) {
            console.error('ACCESS TOKEN IS UNDEFINED');
            res({ ok: false, message: 'Problem with data' });
            return;
        }
        console.log(accessToken);

        console.log('GETTING USERNAME');
        try {
            userInfo = await getUserInfo(accessToken);
        } catch(err) {
            console.error('FAILED GETTING USER INFO', err.response.data);
            res({ ok: false, message: 'Authentication information sent was invalid. Has your session lasted longer than an hour? Error code: ' + err.response.status });
            return;
        }
        const USERNAME = userInfo.name;
        console.log(USERNAME);

        if (exclusionList.length == 0 || exclusionList.length == 1 && exclusionList[0] == '') {
            console.log('REMOVING USER EXCLUSION LIST');
            await firestore.collection('exclusion lists').doc(USERNAME).delete();
        } else {
            console.log('WRITING EXCLUSION LIST TO DB');
            await firestore.collection('exclusion lists').doc(USERNAME).set({
                timestamp: new Date().getTime(),
                subreddits: exclusionList,
            });
        }

        res({ ok: true, message: 'success' });
    });
});

exports.getTokenAndExclusionList = functions.https.onCall( async(data: submitUserLogin_i) => {
    return new Promise(async (res, rej) => {
        let accessToken: string;
        let userInfo: any;
        let subreddits: string[];

        const clientid = functions.config().reddit[data.testing ? 'test_clientid' : 'clientid'];
        const secret = functions.config().reddit[data.testing ? 'test_secret' : 'secret'];

        try {
            ({ accessToken } = await getAccessToken(data['code'], clientid, secret, data.testing));
        } catch(err) {
            console.error('FAILED GETTING ACCESS TOKEN', err.response.data);
            res({ ok: false, message: 'Access token retrieval failed. Error code: ' + err.response.status });
            return;
        }

        if (!accessToken) {
            console.error('ACCESS TOKEN IS UNDEFINED');
            res({ ok: false, message: 'User token retrieval failed' });
            return;
        }

        console.log('GETTING USERNAME');
        try {
            userInfo = await getUserInfo(accessToken);
        } catch(err) {
            console.error('FAILED GETTING USER INFO', err.response.data);
            res({ ok: false, message: 'Retrieval of user identity info failed. Error code: ' + err.response.status });
            return;
        }

        const USERNAME = userInfo.name;
        console.log(USERNAME);
        let exclusionList: string[] = [];

        console.log('GETTING USER SUBREDDITS');
        try {
            subreddits = await getSubreddits(accessToken);
        } catch(err) {
            console.error('FAILED TO GET USER SUBREDDITS', err.response.data);
            res({ ok: false, message: 'Getting user subreddits failed. Error code: ' + err.response.status });
            return;
        }

        console.log('GETTING EXCLUSION LIST FROM FIRESTORE');
        firestore.collection('exclusion lists').doc(USERNAME).get()
            .then(async (doc) => {
                if (!doc.exists) {
                    console.log('USER HAS NO EXCLUSION LIST. RETURNING EMPTY');
                } else {
                    const docData = doc.data();
                    if (docData) {
                        console.log('RETURNING EXISTING EXCLUSION LIST');
                        exclusionList = docData['subreddits'];
                        console.log(JSON.stringify(exclusionList));
                    } else {
                        console.log('USER HAS EMPTY EXCLUSION LIST. RETURNING EMPTY');
                    }
                }
                res({ ok: true, accessToken, subreddits, exclusionList });
                return;
            }).catch(err => {
                console.error('Error getting user document', err);
                res({ ok: false, message: 'db read failure'});
                return;
            });
    });
});