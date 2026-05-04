const express = require("express");
const router = express.Router({ mergeParams: true });

const crypto = require("crypto");
const razorpay = require("../utils/razorpay");

const Booking = require("../models/booking");
const Listing = require("../models/listing");
const { isLoggedIn } = require("../middleware");

router.post("/create-order", isLoggedIn, async (req, res) => {
    try {
        const { id } = req.params;
        const { checkIn, checkOut, guests } = req.body;

        if (!checkIn || !checkOut || !guests) {
            return res.status(400).json({
                success: false,
                message: "All booking details are required."
            });
        }

        const checkInDate = new Date(checkIn);
        const checkOutDate = new Date(checkOut);

        if (checkOutDate <= checkInDate) {
            return res.status(400).json({
                success: false,
                message: "Check-out date must be after check-in date."
            });
        }

        const listing = await Listing.findById(id);

        if (!listing) {
            return res.status(404).json({
                success: false,
                message: "Listing not found."
            });
        }

        if (listing.owner.equals(req.user._id)) {
            return res.status(400).json({
                success: false,
                message: "You cannot book your own listing"
            });
        }

        const conflictingBooking = await Booking.findOne({
            listing: id,
            paymentStatus: { $in: ["Completed", "paid"] },
            checkIn: { $lt: checkOutDate },
            checkOut: { $gt: checkInDate }
        });

        if (conflictingBooking) {
            return res.status(400).json({
                success: false,
                message: "These dates are already booked!"
            });
        }

        const userOverlapBooking = await Booking.findOne({
            user: req.user._id,
            paymentStatus: { $in: ["Completed", "paid"] },
            checkIn: { $lt: checkOutDate },
            checkOut: { $gt: checkInDate }
        });

        if (userOverlapBooking) {
            return res.status(400).json({
                success: false,
                message: "You already have a booking for these dates"
            });
        }

        const userSequentialBooking = await Booking.findOne({
            user: req.user._id,
            paymentStatus: { $in: ["Completed", "paid"] },
            checkOut: { $gt: checkInDate }
        });

        if (userSequentialBooking) {
            return res.status(400).json({
                success: false,
                message: "You can only book a new stay after your current booking ends"
            });
        }

        const nights = Math.ceil(
            (checkOutDate - checkInDate) / (1000 * 60 * 60 * 24)
        );

        const { selectedRooms } = req.body;
        let totalRoomPricePerNight = 0;

        if (selectedRooms && selectedRooms.length > 0) {
            selectedRooms.forEach(room => {
                totalRoomPricePerNight += (room.price * room.count);
            });
        } else {
            totalRoomPricePerNight = listing.price;
        }

        let basePrice = nights * totalRoomPricePerNight;
        let discount = nights >= 7 ? basePrice * 0.10 : 0;
        let subtotal = basePrice - discount;
        let totalPrice = Math.round(subtotal * 1.18);

        const options = {
            amount: Math.round(totalPrice * 100),
            currency: "INR",
            receipt: `receipt_${Date.now()}`,
            payment_capture: 1
        };

        const order = await razorpay.orders.create(options);


        return res.json({
            success: true,
            key_id: process.env.RAZORPAY_KEY_ID,
            order_id: order.id,
            amount: order.amount,
            currency: order.currency,
            listing_title: listing.title,
            booking_details: {
                checkIn,
                checkOut,
                guests,
                nights,
                totalPrice
            },
            selectedRooms
        });

    } catch (err) {
        console.error("Create Order Error:", err);

        return res.status(500).json({
            success: false,
            message: "Something went wrong while creating payment order."
        });
    }
});

router.post("/payment/verify", isLoggedIn, async (req, res) => {
    try {
        const {
            razorpay_order_id,
            razorpay_payment_id,
            razorpay_signature,
            booking_details
        } = req.body;

        if (
            !razorpay_order_id ||
            !razorpay_payment_id ||
            !razorpay_signature ||
            !booking_details
        ) {
            return res.status(400).json({
                success: false,
                message: "Missing payment details."
            });
        }

        const body = razorpay_order_id + "|" + razorpay_payment_id;

        if (!process.env.RAZORPAY_KEY_SECRET) {
            console.error("RAZORPAY_KEY_SECRET not set.");
            return res.status(500).json({ success: false, message: "Server configuration error." });
        }

        const expectedSignature = crypto
            .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET.trim())
            .update(body.toString())
            .digest("hex");

        if (expectedSignature !== razorpay_signature) {
            console.error("Signature mismatch!");
            return res.status(400).json({ success: false, message: "Invalid payment signature!" });
        }

        console.log("Payment status verified successfully.");
        return res.json({ success: true });

    } catch (err) {
        console.error("Payment Verification Error:", err);
        return res.status(500).json({ success: false, message: "Server error during verification." });
    }
});

router.post("/create", isLoggedIn, async (req, res) => {
    try {
        console.log("Booking create payload:", req.body);
        const { id } = req.params;
        const { checkIn, checkOut, guests, totalPrice, paymentMethod, paymentStatus, razorpayOrderId, razorpayPaymentId, razorpaySignature, selectedRooms } = req.body;

        const checkInDate = new Date(checkIn);
        const checkOutDate = new Date(checkOut);

        const listing = await Listing.findById(id);
        if (listing && listing.owner.equals(req.user._id)) {
            return res.status(400).json({ success: false, message: "You cannot book your own listing" });
        }

        const existingBooking = await Booking.findOne({
            listing: id,
            paymentStatus: { $in: ["Completed", "paid"] },
            checkIn: { $lt: checkOutDate },
            checkOut: { $gt: checkInDate }
        });

        if (existingBooking) {
            return res.status(400).json({ success: false, message: "Sorry, these dates were booked during payment." });
        }

        const userOverlapBooking = await Booking.findOne({
            user: req.user._id,
            paymentStatus: { $in: ["Completed", "paid"] },
            checkIn: { $lt: checkOutDate },
            checkOut: { $gt: checkInDate }
        });

        if (userOverlapBooking) {
            return res.status(400).json({ success: false, message: "You already have a booking for these dates" });
        }

        const userSequentialBooking = await Booking.findOne({
            user: req.user._id,
            paymentStatus: { $in: ["Completed", "paid"] },
            checkOut: { $gt: checkInDate }
        });

        if (userSequentialBooking) {
            return res.status(400).json({ success: false, message: "You can only book a new stay after your current booking ends" });
        }

        const newBooking = new Booking({
            listing: id,
            user: req.user._id,
            checkIn: checkInDate,
            checkOut: checkOutDate,
            guests: guests,
            totalPrice: totalPrice,
            paymentMethod: paymentMethod || "pay_later",
            paymentStatus: paymentStatus || "pending",
            razorpayOrderId,
            razorpayPaymentId,
            razorpaySignature,
            selectedRooms: selectedRooms
        });

        await newBooking.save();
        console.log("Booking created successfully:", newBooking._id);

        return res.json({ success: true, message: "Booking confirmed successfully!", bookingId: newBooking._id });

    } catch (err) {
        console.error("Booking Creation Error:", err);
        return res.status(500).json({ success: false, message: "Could not save booking." });
    }
});

module.exports = router;