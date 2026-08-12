const express = require('express');
const { ethers } = require('ethers');
const { provider, contract } = require('../blockchain');
const supabase = require('../supabase');

const router = express.Router();

router.post('/verify-mint', async (req, res) => {
  const { txHash, imageCid, metadataCid } = req.body;

  if (!txHash) {
    return res.status(400).json({
      success: false,
      verified: false,
      error: 'txHash is required',
    });
  }

  if (!imageCid || !metadataCid) {
    return res.status(400).json({
      success: false,
      verified: false,
      error: 'imageCid and metadataCid are required',
    });
  }

  if (!ethers.isHexString(txHash, 32)) {
    return res.status(400).json({
      success: false,
      verified: false,
      error: 'Invalid transaction hash format',
    });
  }

  try {
    // 1. Idempotency Check: check if transaction was already verified & stored in Supabase
    const { data: existingNft } = await supabase
      .from('nfts')
      .select('*')
      .eq('transaction_hash', txHash)
      .maybeSingle();

    if (existingNft) {
      return res.json({
        success: true,
        verified: true,
        alreadyExists: true,
        txHash,
        tokenId: String(existingNft.token_id),
        owner: existingNft.owner_wallet,
        market: existingNft.market,
        price: String(existingNft.eth_usd_price),
        contractAddress: existingNft.contract_address,
      });
    }

    // 2. Fetch receipt directly from Sepolia blockchain
    const receipt = await provider.getTransactionReceipt(txHash);

    if (!receipt) {
      return res.status(404).json({
        success: false,
        verified: false,
        error: 'Transaction not found or not mined yet',
      });
    }

    if (receipt.status !== 1) {
      return res.status(400).json({
        success: false,
        verified: false,
        error: 'Transaction failed on-chain',
      });
    }

    // 3. Parse NFTMinted event from logs
    let mintedEvent = null;

    for (const log of receipt.logs) {
      try {
        const parsed = contract.interface.parseLog(log);
        if (parsed && parsed.name === 'NFTMinted') {
          mintedEvent = parsed;
          break;
        }
      } catch {
        // Ignore logs that don't belong to our contract ABI
      }
    }

    if (!mintedEvent) {
      return res.status(400).json({
        success: false,
        verified: false,
        error: 'NFTMinted event not found in receipt',
      });
    }

    const tokenId = mintedEvent.args.tokenId;
    const to = mintedEvent.args.to;
    const marketValue = Number(mintedEvent.args.market);
    const price = mintedEvent.args.price;

    const markets = ['Bearish', 'Neutral', 'Bullish'];

    if (marketValue < 0 || marketValue >= markets.length) {
      return res.status(400).json({
        success: false,
        verified: false,
        error: 'Invalid market value in event',
      });
    }

    const market = markets[marketValue];
    const ethUsdPrice = Number(ethers.formatUnits(price, 8));

    // 4. Save verified record to Supabase
    const { data: nft, error: supabaseError } = await supabase
      .from('nfts')
      .insert({
        token_id: Number(tokenId),
        owner_wallet: to,
        market,
        eth_usd_price: ethUsdPrice,
        transaction_hash: txHash,
        contract_address: receipt.to,
        image_cid: imageCid,
        metadata_cid: metadataCid,
      })
      .select()
      .single();

    if (supabaseError) {
      console.error('Supabase NFT insert failed:', supabaseError);

      // Duplicate key error handler (code 23505)
      if (supabaseError.code === '23505') {
        return res.json({
          success: true,
          verified: true,
          alreadyExists: true,
          txHash,
          tokenId: tokenId.toString(),
          owner: to,
          market,
          price: ethUsdPrice.toString(),
          contractAddress: receipt.to,
        });
      }

      return res.status(500).json({
        success: false,
        verified: false,
        error: 'NFT verified but failed to save to database',
      });
    }

    res.json({
      success: true,
      verified: true,
      txHash,
      tokenId: tokenId.toString(),
      owner: to,
      market,
      marketValue,
      price: ethUsdPrice.toString(),
      blockNumber: receipt.blockNumber,
      contractAddress: receipt.to,
    });
  } catch (err) {
    console.error('Mint verification failed:', err);

    res.status(500).json({
      success: false,
      verified: false,
      error: 'Failed to verify mint transaction: ' + (err.message || 'Internal error'),
    });
  }
});

module.exports = router;