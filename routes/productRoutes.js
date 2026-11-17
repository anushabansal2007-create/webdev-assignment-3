
const express = require("express");
const mongoose = require("mongoose");
const Product = require("../models/Product");

const router = express.Router();

// Async error handler
const asyncHandler = (fn) => (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
};

// Validate product ID
const validateId = (req, res, next) => {
    if (!mongoose.isValidObjectId(req.params.id)) {
        return res.status(400).json({
            message: "Invalid product ID"
        });
    }
    next();
};

// 1. CREATE PRODUCT
router.post("/", asyncHandler(async (req, res) => {
    const product = await Product.create(req.body);

    res.status(201).json(product);
}));

// 2. GET ALL PRODUCTS
// Filtering, searching, sorting and pagination
router.get("/", asyncHandler(async (req, res) => {
    const {
        category,
        search,
        sort = "-createdAt",
        page = 1,
        limit = 10
    } = req.query;

    const currentPage = Number(page);
    const pageLimit = Number(limit);

    if (
        !Number.isInteger(currentPage) ||
        !Number.isInteger(pageLimit) ||
        currentPage < 1 ||
        pageLimit < 1 ||
        pageLimit > 100
    ) {
        return res.status(400).json({
            message: "Invalid page or limit"
        });
    }

    const filter = {};

    if (category) {
        filter.category = {
            $regex: category,
            $options: "i"
        };
    }

    if (search) {
        filter.$or = [
            { name: { $regex: search, $options: "i" } },
            { sku: { $regex: search, $options: "i" } },
            { supplier: { $regex: search, $options: "i" } }
        ];
    }

    const allowedSortFields = [
        "name",
        "price",
        "quantity",
        "createdAt",
        "category"
    ];

    const sortField = sort.startsWith("-")
        ? sort.substring(1)
        : sort;

    if (!allowedSortFields.includes(sortField)) {
        return res.status(400).json({
            message: "Invalid sort field"
        });
    }

    const sortOrder = sort.startsWith("-") ? -1 : 1;

    const total = await Product.countDocuments(filter);

    const products = await Product.find(filter)
        .sort({ [sortField]: sortOrder })
        .skip((currentPage - 1) * pageLimit)
        .limit(pageLimit);

    res.status(200).json({
        total,
        page: currentPage,
        totalPages: Math.ceil(total / pageLimit),
        count: products.length,
        products
    });
}));

// 3. LOW STOCK REPORT
router.get("/reports/low-stock", asyncHandler(async (req, res) => {
    const products = await Product.find({
        $expr: {
            $lte: ["$quantity", "$reorderLevel"]
        }
    }).sort({ quantity: 1 });

    res.status(200).json({
        message: "Low stock report generated successfully",
        count: products.length,
        products
    });
}));

// 4. CATEGORY-WISE INVENTORY SUMMARY
router.get("/reports/category-summary", asyncHandler(async (req, res) => {
    const summary = await Product.aggregate([
        {
            $group: {
                _id: "$category",
                totalProducts: { $sum: 1 },
                totalQuantity: { $sum: "$quantity" },
                totalStockValue: {
                    $sum: {
                        $multiply: ["$price", "$quantity"]
                    }
                }
            }
        },
        {
            $project: {
                _id: 0,
                category: "$_id",
                totalProducts: 1,
                totalQuantity: 1,
                totalStockValue: 1
            }
        },
        {
            $sort: { category: 1 }
        }
    ]);

    res.status(200).json({
        message: "Category-wise inventory summary",
        summary
    });
}));

// 5. GET SINGLE PRODUCT BY ID
router.get("/:id", validateId, asyncHandler(async (req, res) => {
    const product = await Product.findById(req.params.id);

    if (!product) {
        return res.status(404).json({
            message: "Product not found"
        });
    }

    res.status(200).json(product);
}));

// 6. UPDATE PRODUCT DETAILS
router.put("/:id", validateId, asyncHandler(async (req, res) => {
    const allowedFields = [
        "name",
        "sku",
        "category",
        "price",
        "quantity",
        "reorderLevel",
        "supplier"
    ];

    const updateData = {};

    for (const field of allowedFields) {
        if (Object.prototype.hasOwnProperty.call(req.body, field)) {
            updateData[field] = req.body[field];
        }
    }

    if (Object.keys(updateData).length === 0) {
        return res.status(400).json({
            message: "Please provide product details to update"
        });
    }

    const product = await Product.findByIdAndUpdate(
        req.params.id,
        updateData,
        {
            new: true,
            runValidators: true
        }
    );

    if (!product) {
        return res.status(404).json({
            message: "Product not found"
        });
    }

    res.status(200).json({
        message: "Product updated successfully",
        product
    });
}));

// 7. RESTOCK OR SELL PRODUCT
router.patch("/:id/stock", validateId, asyncHandler(async (req, res) => {
    const { action, quantity } = req.body;

    if (
        !["restock", "sale"].includes(action) ||
        !Number.isInteger(quantity) ||
        quantity <= 0
    ) {
        return res.status(400).json({
            message: "Provide action as restock or sale and a positive integer quantity"
        });
    }

    let product;

    if (action === "restock") {
        product = await Product.findByIdAndUpdate(
            req.params.id,
            { $inc: { quantity: quantity } },
            { new: true, runValidators: true }
        );
    } else {
        product = await Product.findOneAndUpdate(
            {
                _id: req.params.id,
                quantity: { $gte: quantity }
            },
            {
                $inc: { quantity: -quantity }
            },
            {
                new: true,
                runValidators: true
            }
        );

        if (!product) {
            const existing = await Product.exists({
                _id: req.params.id
            });

            if (!existing) {
                return res.status(404).json({
                    message: "Product not found"
                });
            }

            return res.status(400).json({
                message: "Insufficient stock"
            });
        }
    }

    if (!product) {
        return res.status(404).json({
            message: "Product not found"
        });
    }

    res.status(200).json({
        message: action === "restock"
            ? "Stock restocked successfully"
            : "Sale completed successfully",
        product
    });
}));

// 8. DELETE PRODUCT
router.delete("/:id", validateId, asyncHandler(async (req, res) => {
    const product = await Product.findByIdAndDelete(req.params.id);

    if (!product) {
        return res.status(404).json({
            message: "Product not found"
        });
    }

    res.status(200).json({
        message: "Product deleted",
        id: product._id
    });
}));

module.exports = router;
