const Listing = require("../models/listing");
const { geocodeLocation } = require("../utils/geocoding");

module.exports.index = async (req, res) => {
    let queryObj = {};
    let searchActive = false;

    if (req.query.q) {
        searchActive = true;
    } else if (req.query.category) {
        queryObj.category = req.query.category;
    }

    let allListings;
    let matchCount = 0;
    if (searchActive) {
        // Fetch all listings but filter them to only include matches
        const rawListings = await Listing.find({}).populate("reviews");
        const regex = new RegExp(req.query.q, 'i');
        
        allListings = rawListings.filter(listing => {
            const isMatch = (listing.title && regex.test(listing.title)) || 
                           (listing.location && regex.test(listing.location)) || 
                           (listing.country && regex.test(listing.country));
            if (isMatch) {
                listing.isMatch = true;
                matchCount++;
                return true;
            }
            return false;
        });

        // Optional: Sort matches if needed (e.g. by title)
        allListings.sort((a, b) => a.title.localeCompare(b.title));
    } else {
        allListings = await Listing.find(queryObj).populate("reviews");
    }
    
    res.render("listings/index", { allListings, searchQuery: req.query.q, matchCount });
};

module.exports.searchSuggestions = async (req, res) => {
    let { q } = req.query;
    if (!q) return res.json([]);

    let regex = new RegExp(q, 'i');
    
    // Find matching documents and extract unique locations/countries/titles
    const listings = await Listing.find({
        $or: [
            { location: regex },
            { country: regex },
            { title: regex }
        ]
    }).limit(10).select("location country title");

    let suggestions = new Set();
    listings.forEach(listing => {
        if (listing.location && listing.location.toLowerCase().includes(q.toLowerCase())) suggestions.add(listing.location);
        if (listing.country && listing.country.toLowerCase().includes(q.toLowerCase())) suggestions.add(listing.country);
        if (listing.title && listing.title.toLowerCase().includes(q.toLowerCase())) suggestions.add(listing.title);
    });

    res.json(Array.from(suggestions).slice(0, 5));
};

module.exports.renderNewForm = (req, res) => {
    res.render("listings/new");
};

module.exports.showListing = async (req, res) => {
    let { id } = req.params;

    const listing = await Listing.findById(id)
        .populate("owner")
        .populate({
            path: "reviews",
            populate: {
                path: "author"
            }
        });

    if (!listing) {
        req.flash("error", "Listing not found");
        return res.redirect("/listings");
    }

    if (listing.amenities.length === 0) {
        listing.amenities = ["Wifi", "Kitchen", "Free Parking", "TV", "Air Conditioning"];
    }

    if (listing.rooms.length === 0) {
        listing.rooms = [
            { type: "2-bed", capacity: 2, quantity: 5, basePrice: listing.price },
            { type: "3-bed", capacity: 3, quantity: 2, basePrice: Math.round(listing.price * 1.4) },
            { type: "4-bed", capacity: 4, quantity: 1, basePrice: Math.round(listing.price * 1.8) }
        ];
    }

    res.render("listings/show", { listing });
};

module.exports.createListing = async (req, res) => {
    let url = req.file.path;
    let filename=req.file.filename;
    console.log(url,"..",filename);
    const newListing = new Listing(req.body.listing);
    
    newListing.geometry = await geocodeLocation(newListing.location);

    newListing.owner = req.user._id;
    newListing.image = {url, filename};


    await newListing.save();
    req.flash("success", "Listing created");
    res.redirect("/listings");
};

module.exports.renderEditForm = async (req, res) => {
    let { id } = req.params;
    const listing = await Listing.findById(id);
     if(!listing){
        req.flash("error","Listing you requested for does not exist!");
        return res.redirect("/listings");
    }
    let originalImageUrl=listing.image.url;
    originalImageUrl = originalImageUrl.replace("upload","/upload/h_300,w_250");
    res.render("listings/edit", { listing,originalImageUrl });
};

module.exports.updateListing = async (req, res) => {
    let { id } = req.params;
    
   
    let location = req.body.listing.location;
    let geometry = await geocodeLocation(location);

    let listing = await Listing.findByIdAndUpdate(id, { ...req.body.listing, geometry });

    if(typeof req.file !=="undefined"){
        let url = req.file.path;
        let filename=req.file.filename;
        listing.image = {url, filename};
        await listing.save();
    }
    req.flash("success", "Updated");
    res.redirect(`/listings/${id}`);
};

module.exports.deleteListing = async (req, res) => {
    let { id } = req.params;
    await Listing.findByIdAndDelete(id);
    req.flash("success", "Deleted");
    
    // Redirect to dashboard if the request came from there, otherwise to listings index
    const redirectUrl = req.headers.referer && req.headers.referer.includes("host/listings") 
        ? "/host/listings" 
        : "/listings";
    res.redirect(redirectUrl);
};