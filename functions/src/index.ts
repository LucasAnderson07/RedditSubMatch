import * as functions from 'firebase-functions';
import { getAccessToken, getUserInfo, revokeRefreshToken, testRefreshToken } from './helpers';
import * as admin from 'firebase-admin';

admin.initializeApp()
const firestore = admin.firestore()
const database = admin.database()

interface submitUserLogin_i {
    code: string
}

exports.submitUserLogin = functions.https.onCall(async (data: submitUserLogin_i) => {
    return new Promise(async (res, rej) => {
        let accessToken
        let refreshToken: string
        let userInfo
        let USERNAME: string
        let resp: any

        console.log("ADDING USER TOKEN")
        console.log("GETTING TOKEN(S)")
        try {
            ({ refreshToken, accessToken } = await getAccessToken(data.code, functions.config().reddit.clientid, functions.config().reddit.secret))
        } catch(err) {
            console.error("FAILED GETTING ACCESS TOKEN AND REFRESH TOKEN", err)
            res({ ok: false, message: "Access token retrieval failed. Error code: " + err.error.error })
            return
        }
        console.log(accessToken)
        console.log(refreshToken)
        if (!accessToken && !refreshToken) {
            console.error("ACCESS TOKEN AND REFRESH TOKEN ARE UNDEFINED")
            res({ ok: false, message: "User token retrieval failed" })
            return
        }

        console.log("GETTING USERNAME")
        try {
            userInfo = await getUserInfo(accessToken)
        } catch(err) {
            console.error("[Submit] FAILED GETTING USER INFO", err)
            await firestore.collection("unnamed tokens").doc(new Date().getTime().toString()).set({
                    error: err['error']['error'],
                    refreshToken
                })
            res({ ok: true, message: "success" })
            return
        }
        console.log(userInfo)

        USERNAME = userInfo.name
        console.log(USERNAME)

        firestore.collection('users').doc(USERNAME).get()
            .then(async (doc) => {
                if (!doc.exists) {
                    console.log('User has not yet signed up, will write to db')
                } else {
                    let docData = doc.data()
                    let currentRefreshToken
                    if (docData) {
                        currentRefreshToken = docData['refreshToken']
                        if (!currentRefreshToken) {
                            console.log('Cannot retrieve document refresh token; no refresh token')
                        } else {
                            console.log('Current refresh token: ' + currentRefreshToken)
                            console.log('CHECKING IF CURRENT REFRESH TOKEN IS VALID')
                            try {
                                resp = await testRefreshToken(currentRefreshToken, functions.config().reddit.clientid, functions.config().reddit.secret)
                            } catch (err) {
                                if (err.error.error != 400) {
                                    console.error('FAILED TO TEST CURRENT REFRESH TOKEN', err)
                                    res({ ok: false, message: "Failed to test current refresh token: Error code: " + err.error.error })
                                    return
                                } else {
                                    console.log(err)
                                    console.log('Received bad request error when testing current refresh token')
                                    resp = { access_token: null }
                                }
                            }
                            console.log(resp)
                            if (!resp['access_token']) {
                                console.log('SAVED REFRESH TOKEN IS INVALID, REVOKING')
                                try {
                                    resp = await revokeRefreshToken(currentRefreshToken, functions.config().reddit.clientid, functions.config().reddit.secret)
                                } catch(err) {
                                    console.error("FAILED REVOKING SAVED REFRESH TOKEN", err)
                                    res({ ok: false, message: "Revoking of saved refresh token failed. Error code: " + err.error.error })
                                    return
                                }
                                console.log(resp)
                                console.log("OVERWRITING SAVED REFRESH TOKEN")
                                await firestore.collection("users").doc(USERNAME).set({
                                    timestamp: new Date().getTime(),
                                    refreshToken,
                                })
                            } else {
                                console.log('REVOKING CURRENT REFRESH TOKEN')
                                try {
                                    resp = await revokeRefreshToken(refreshToken, functions.config().reddit.clientid, functions.config().reddit.secret)
                                } catch(err) {
                                    console.error("FAILED REVOKING CURRENT REFRESH TOKEN", err)
                                    res({ ok: false, message: "Revoking of current refresh token failed. Error code: " + err.error.error })
                                    return
                                }
                                res({ ok: true, message: "success" })
                                return
                            }
                        }
                    } else {
                        console.log('Cannot retrieve document data; data empty')
                    }
                }
                console.log("ADDING TO FIRESTORE DB")
                await firestore.collection("users").doc(USERNAME).set({
                    timestamp: new Date().getTime(),
                    refreshToken,
                })
                res({ ok: true, message: "success" })
                return
            }).catch(err => {
              console.error('Submit: Error getting user document', err)
              res({ ok: false, message: 'db read failure'})
              return
            });
    })
})

exports.deleteUserInfo = functions.https.onCall(async (data: submitUserLogin_i) => {
    return new Promise(async (res, rej) => {
        let accessToken: string
        let resp
        let userInfo
        let USERNAME: string

        console.log("DELETING USER INFO")
        console.log("GETTING ACCESS TOKEN")
        try {
            ({ accessToken } = await getAccessToken(data.code, functions.config().reddit.clientid, functions.config().reddit.secret))
        } catch(err) {
            console.error("FAILED GETTING ACCESS TOKEN", err)
            res({ ok: false, message: "Access token retrieval failed. Error code: " + err.error.error })
            return
        }
        console.log(accessToken)

        if (!accessToken) {
            console.error("ACCESS TOKEN IS UNDEFINED")
            res({ ok: false, message: "User token retrieval failed" })
            return
        }
        console.log("GETTING USERNAME")
        try {
            userInfo = await getUserInfo(accessToken)
        } catch(err) {
            console.error("[Delete] FAILED GETTING USER INFO", err)
            res({ ok: false, message: "Retrieval of user identity info failed. Error code: " + err.error.error })
            return
        }

        USERNAME = userInfo.name
        console.log(USERNAME)

        console.log("GETTING USER CURRENT REFRESH TOKEN")
        firestore.collection('users').doc(USERNAME).get()
            .then(async (doc) => {
                if (!doc.exists) {
                    console.log('Cannot retrieve document; no such document')
                    await firestore.collection("empty deletes").doc(USERNAME).set({
                        timestamp: new Date().getTime(),
                    })
                } else {
                    let docData = doc.data()
                    let refreshToken
                    if (docData) {
                        refreshToken = docData['refreshToken']
                        if (!refreshToken) {
                            console.log('Error getting document refresh token; no refresh token')
                        } else {
                            console.log(refreshToken)
                        }
                    } else {
                        console.log('Cannot retrieve document data; data empty')
                    }

                    if (refreshToken) {
                        console.log("REVOKING PERMANENT REFRESH TOKEN")
                        try {
                            resp = await revokeRefreshToken(refreshToken, functions.config().reddit.clientid, functions.config().reddit.secret)
                        } catch(err) {
                            console.error("FAILED REVOKING REFRESH TOKEN", err)
                            res({ ok: false, message: "Revoking of refresh token failed. Error code: " + err.error.error })
                            return
                        }
                        console.log(resp)
                    }

                    console.log("DELETING USER FROM FIRESTORE DB")
                    await firestore.collection("users").doc(USERNAME).delete()
                }

                res({ ok: true, message: "success" })
            }).catch(err => {
              console.error('Delete: Error getting user document', err)
              res({ ok: false, message: 'db read failure'})
            });
    })
})

exports.documentWriteListener = functions.firestore.document('users/{documentUid}').onWrite((change, context) => {
    return new Promise(async (res, rej) => {
        if (!change.before.exists) {
            console.log("INCREMENTING SIGNUP COUNTER")
            database.ref("signup_count").transaction(function (current_value: any) {
                return (current_value || 0) + 1;
            });
        } else if (!change.after.exists) {
            console.log("DECREMENTING SIGNUP COUNTER")
            database.ref("signup_count").transaction(function (current_value: any) {
                return (current_value || 0) - 1;
            });
        }
        res({ ok: true })
    })
})
