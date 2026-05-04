const express = require("express");
const router = express.Router();
const hostController = require("../controllers/hostController");
const { isLoggedIn, isOwner } = require("../middleware");
const multer = require('multer');
const { storage } = require("../cloudconfig.js");
const upload = multer({ storage });

// Middleware to ensure user is logged in
router.use(isLoggedIn);

router.get("/dashboard", hostController.index);
router.get("/listings", hostController.listings);
router.get("/bookings", hostController.bookings);
router.get("/earnings", hostController.earnings);
router.get("/reviews", hostController.reviews);
router.get("/profile", hostController.profile);
router.patch("/profile", upload.single("avatar"), hostController.updateProfile);
router.post("/profile/password", hostController.changePassword);
router.patch("/listings/:id/status", hostController.toggleListingStatus);

module.exports = router;
