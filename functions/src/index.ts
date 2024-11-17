/**
 * Import function triggers from their respective submodules:
 *
 * import {onCall} from "firebase-functions/v2/https";
 * import {onDocumentWritten} from "firebase-functions/v2/firestore";
 *
 * See a full list of supported triggers at https://firebase.google.com/docs/functions
 */

// import { onRequest } from "firebase-functions/v2/https";

import { onSchedule } from "firebase-functions/v2/scheduler";
import { Firestore, Timestamp } from "firebase-admin/firestore";
import { onRequest } from "firebase-functions/v1/https";
import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { Message, Messaging, getMessaging } from 'firebase-admin/messaging'
import { setGlobalOptions } from "firebase-functions/v2";
setGlobalOptions({ maxInstances: 10 });
// import { onRequest } from "firebase-functions/v2/https";
// import * as logger from "firebase-functions/logger";

// Start writing functions
// https://firebase.google.com/docs/functions/typescript

var db: Firestore | undefined;
var messaging: Messaging | undefined;
function initFirestore(): Firestore {
        if (!db) {
                db = new Firestore();
        }
        return db;
}

function initMessaging(): Messaging {
        if (!messaging) {
                messaging = getMessaging();
        }
        return messaging;
}

function getWeekIds() {
        // according to current date get the next 7 days in the format YYYY-MM-DD
        const weekIds = [];
        const today = new Date();
        while (weekIds.length < 7) {
                const date = today.getDate();
                const month = today.getMonth() + 1;
                const year = today.getFullYear();
                const dateString = `${year}-${month}-${date}`;
                weekIds.push(dateString);
                today.setDate(today.getDate() + 1);
        }
        return weekIds;
}

// TODO: function to reset the working status of every agent if the upcoming week is undefined.
// start this function every day at 01:00 Am IST (UTC +5:30)
export const resetWorkingStatus = onSchedule(
        {
                schedule: "0 1 * * *",
                timeZone: "Asia/Kolkata",
                maxInstances: 2,
        },
        async (context) => {
            let db = initFirestore();
            const agentsRef = db.collection("agents");
            const agentsSnapshot = await agentsRef.get();
            const WEEK_IDS = getWeekIds();
            await Promise.all(
                    agentsSnapshot.docs.map(async (agentDoc, index) => {
                            let agentData = agentDoc.data();
                            // fetch slots for every agent agent/{agentId}/slots
                            // fetch only the upcoming week slots
                            let slotDocs = await db.getAll(
                                    ...WEEK_IDS.map((weekId) =>
                                            agentDoc.ref
                                                    .collection("slots")
                                                    .doc(weekId)
                                    )
                            );
                            let workingStatus = slotDocs.some(
                                    (slotDoc) =>
                                            slotDoc.data() &&
                                            slotDoc.data()!["working"]
                            );
                            if (agentData) {
                                    if (!(agentData.working instanceof Timestamp)) {
                                            await agentDoc.ref.update({
                                                    working: workingStatus,
                                            });
                                    }
                            }
                    })
            );
        }
);

const GOOGLE_API_KEY = 'REPLACEMENT_STRING';

export const getAreaOnSearch = onRequest(async (request, response) => {
        response.set('Access-Control-Allow-Origin', '*');
        const resp = await fetch(`https://maps.googleapis.com/maps/api/place/textsearch/json?query=${request.query.searchInput}&key=${GOOGLE_API_KEY}`);
        const data = await resp.json();
        response.send(data);
});

export const getAreaDetailByPlaceId = onRequest(async (request, response) => {
        response.set('Access-Control-Allow-Origin', '*');
        const resp = await fetch(`https://maps.googleapis.com/maps/api/place/details/json?place_id=${request.query.placeId}&key=${GOOGLE_API_KEY}`);
        const data = await resp.json();
        response.send(data);
});

export const getAreaDetailByLatLng = onRequest(async (request, response) => {
        response.set('Access-Control-Allow-Origin', '*');
        const resp = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?latlng=${request.query.lat},${request.query.lng}&key=${GOOGLE_API_KEY}`);
        const data = await resp.json();
        response.send(data);
});

export const notifyAgent = onDocumentCreated("agents/{agentId}/notifications/{notificationId}", async (event) => {
        if (event.data?.exists){
                const db = initFirestore();
                const messaging = initMessaging();
                const notificationData = event.data.data();
                // get current agent 
                const agentRef = db.collection("agents").doc(event.params.agentId);
                const agentDoc = await agentRef.get();
                const agentData = agentDoc.data();
                if (agentData && agentData.notificationToken && notificationData && notificationData.title && notificationData.body) {
                        const message:Message = {
                                notification: {
                                        title: notificationData.title,
                                        body: notificationData.body,
                                },
                                token: agentData.notificationToken,
                        };
                        await messaging.send(message);
                        event.data.ref.update({sent: true,at: new Date()});
                } else {
                        event.data.ref.update({sent: false,at: new Date(),error:"Missing details"});
                }
        }
});
export const duplicateServiceCatalogue = onRequest(async (request, response) => {
        response.set('Access-Control-Allow-Origin', '*');
        const id = request.query.id;
        let db = initFirestore();
        const serviceCatalogueRef = db.collection("service-catalogue");
        const serviceCatalogueSnapshot = await serviceCatalogueRef.get();
        const catalogues = serviceCatalogueSnapshot.docs.filter((catalog) => {
                return catalog.id === id;
        });
        const catalog = catalogues.length ?  catalogues[0].data() : null;
        if (!catalog) {
                response.send({err: 'No Catalog found with the id provided'});        
        } else {
                const res = await db.collection('service-catalogue').add({
                        active: catalog.active,
                        created: new Date(),
                        name: `Copy of ${catalog.name}`
                });
                const addedCatalogId = res.id;
                const MainCatRef = db.collection(`service-catalogue/${catalog.id}/categories`);
                const MainCatSnapshot = await MainCatRef.get();
                MainCatSnapshot.docs.map(async (category) => {
                        const catData: any = {...category.data(), id: ''};
                        const resCat = await db.collection(`service-catalogue/${addedCatalogId}/categories`).add(catData);
                        const addedCategoryId = resCat.id;

                        const SubCatRef = db.collection(`service-catalogue/${catalog.id}/categories/${category.id}/categories`);
                        const SubCatSnapshot = await SubCatRef.get();
                        SubCatSnapshot.docs.map(async (subcategory) => {
                                const subcatData: any = {...subcategory.data(), id: ''};
                                const resSubcat = await db.collection(`service-catalogue/${addedCatalogId}/categories/${addedCategoryId}/categories`).add(subcatData);
                                const addedSubCategoryId = resSubcat.id;

                                const ServicesRef = db.collection(`service-catalogue/${catalog.id}/categories/${category.id}/categories/${subcategory.id}/services`);
                                const ServicesSnapshot = await ServicesRef.get();
                                ServicesSnapshot.docs.map(async (service) => {
                                        const serviceData: any = {...service.data(), id: ''};
                                        await db.collection(`service-catalogue/${addedCatalogId}/categories/${addedCategoryId}/categories/${addedSubCategoryId}/services`).add(serviceData);
                                });
                        });
                });
                response.send({stat: 'Success'});
        }
});

export const expireBookings = onSchedule(
        {
                schedule: "01 0 * * *",
                timeZone: "Asia/Kolkata",
                maxInstances: 2,
        },
        async (context) => {
                let db = initFirestore();
                const bookingsRef = db.collectionGroup("bookings");
                const bookingsSnapshot = await bookingsRef.get();
                const today = new Date();
                const stages = ['allotmentPending', 'acceptancePending', 'jobAccepted', 'otpVerificationPending']
                await Promise.all(
                        bookingsSnapshot.docs.map(async (bookingDoc, index) => {
                                let bookingData = bookingDoc.data();
                                if (bookingData.timeSlot && new Date(bookingData.timeSlot.date.seconds * 1000) < today && stages.includes(bookingData.stage)) {
                                        try {
                                                await db.doc(`users/${bookingData.currentUser.userId}/bookings/${bookingData.id}`).update({stage: 'expired', cancelReason: 'Auto expired by system as the booking was not processed until its scheduled slot time', expiredAt: new Date()});
                                        } catch(e) {
                                                console.log(e);
                                        }
                                }
                        })
                );
        }
);

export const createOrder = onRequest(async (request, response) => {
        response.set('Access-Control-Allow-Origin', '*');
        // const resp = await fetch(`https://maps.googleapis.com/maps/api/place/textsearch/json?query=${request.query.searchInput}&key=${GOOGLE_API_KEY}`);
        // const data = await resp.json();
        response.send(request.body);
});