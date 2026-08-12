const express = require('express');
const multer = require('multer');
const axios = require('axios');
const FormData = require('form-data');
const rateLimit = require('express-rate-limit');

const router = express.Router();

const uploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: 'Too many requests, please try again after 15 minutes.',
  },
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024,
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = [
      'image/png',
      'image/jpeg',
      'image/webp',
      'image/svg+xml',
    ];

    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Unsupported file type. Use PNG, JPEG, WEBP, or SVG.'));
    }
  },
});

router.post('/upload-image', uploadLimiter, upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, error: 'No file provided.' });
  }

  try {
    const formData = new FormData();

    formData.append('file', req.file.buffer, {
      filename: req.file.originalname,
      contentType: req.file.mimetype,
    });

    formData.append('network', 'public');

    const pinataResponse = await axios.post(
      'https://uploads.pinata.cloud/v3/files',
      formData,
      {
        headers: {
          ...formData.getHeaders(),
          Authorization: `Bearer ${process.env.PINATA_JWT}`,
        },
        maxBodyLength: Infinity,
      }
    );

    const cid = pinataResponse.data?.data?.cid;

    if (!cid) {
      throw new Error('Pinata did not return a CID.');
    }

    res.json({ success: true, cid });
  } catch (err) {
    const detail = err.response?.data?.error?.details || err.response?.data?.error || err.message;
    console.error('Pinata upload failed:', detail);

    res.status(500).json({
      success: false,
      error: `Image upload failed: ${detail || 'Please try again.'}`,
    });
  }
});

const VALID_MARKETS = ['Bearish', 'Neutral', 'Bullish'];

router.post('/upload-metadata', uploadLimiter, async (req, res) => {
  const { tokenId, market, ethUsdPrice, imageCid } = req.body;

  if (
    tokenId === undefined ||
    !market ||
    ethUsdPrice === undefined ||
    !imageCid
  ) {
    return res.status(400).json({
      success: false,
      error: 'Missing required fields: tokenId, market, ethUsdPrice, imageCid',
    });
  }

  if (!VALID_MARKETS.includes(market)) {
    return res.status(400).json({
      success: false,
      error: `Invalid market. Must be one of: ${VALID_MARKETS.join(', ')}`,
    });
  }

  const metadata = {
    name: `ChainLinkNFT #${tokenId}`,
    description:
      'A ChainLinkNFT whose market classification is determined from the Chainlink ETH/USD price at mint time.',
    image: `ipfs://${imageCid}`,
    attributes: [
      { trait_type: 'Market', value: market },
      { trait_type: 'ETH/USD', value: String(ethUsdPrice) },
    ],
  };

  try {
    const metadataBuffer = Buffer.from(JSON.stringify(metadata));

    const formData = new FormData();

    formData.append('file', metadataBuffer, {
      filename: `chainlinknft-${tokenId}-metadata.json`,
      contentType: 'application/json',
    });

    formData.append('network', 'public');

    const pinataResponse = await axios.post(
      'https://uploads.pinata.cloud/v3/files',
      formData,
      {
        headers: {
          ...formData.getHeaders(),
          Authorization: `Bearer ${process.env.PINATA_JWT}`,
        },
        maxBodyLength: Infinity,
      }
    );

    const metadataCid = pinataResponse.data?.data?.cid;

    if (!metadataCid) {
      throw new Error('Pinata did not return a CID for the metadata.');
    }

    res.json({
      success: true,
      metadataCid,
      metadataUri: `ipfs://${metadataCid}`,
      metadata,
    });
  } catch (err) {
    const detail = err.response?.data?.error?.details || err.response?.data?.error || err.message;
    console.error('Pinata metadata upload failed:', detail);

    res.status(500).json({
      success: false,
      error: `Metadata upload failed: ${detail || 'Please try again.'}`,
    });
  }
});

module.exports = router;