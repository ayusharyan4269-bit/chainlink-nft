import { useState, useEffect } from 'react';
import { ethers } from 'ethers';
import { CONTRACT_ADDRESS, CONTRACT_ABI } from './contract';
import { supabase } from './supabase';
import './App.css';

const SEPOLIA_CHAIN_ID = 11155111n;
const ETHERSCAN_BASE = 'https://sepolia.etherscan.io';
const BACKEND_URL =
  import.meta.env.VITE_BACKEND_URL || 'http://localhost:3001';

async function safeFetchJson(url, options) {
  let response;
  try {
    response = await fetch(url, options);
  } catch (err) {
    throw new Error(`Network error connecting to backend: ${err.message}`);
  }

  const text = await response.text();

  if (!text || !text.trim()) {
    throw new Error(
      `Backend returned empty response (Status ${response.status})`
    );
  }

  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    throw new Error(
      `Backend returned non-JSON response (Status ${response.status}): ${text.slice(0, 150)}`
    );
  }

  try {
    const data = JSON.parse(text);
    return { ok: response.ok, status: response.status, data };
  } catch (err) {
    throw new Error(
      `Failed to parse backend JSON response (Status ${response.status}): ${err.message}`
    );
  }
}

const MARKET_META = {
  Bearish: {
    emoji: '🐻',
    label: 'BEARISH',
    className: 'bearish',
  },
  Neutral: {
    emoji: '⚖️',
    label: 'NEUTRAL',
    className: 'neutral',
  },
  Bullish: {
    emoji: '🐂',
    label: 'BULLISH',
    className: 'bullish',
  },
};

function shortenAddress(addr) {
  if (!addr) return '';
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

function App() {

  const loadNFTs = async () => {
  setNftsLoading(true);

  const { data, error } = await supabase
    .from('nfts')
    .select('*')
    .order('minted_at', { ascending: false });

  if (error) {
    console.error('Failed to load NFTs:', error);
    setNftsLoading(false);
    return;
  }

  setNfts(data || []);
  setNftsLoading(false);

};

  const [walletAddress, setWalletAddress] = useState(null);
  const [chainId, setChainId] = useState(null);
  const [ethPrice, setEthPrice] = useState(null);
  const [priceLoading, setPriceLoading] = useState(false);
  const [status, setStatus] = useState('');
  const [minting, setMinting] = useState(false);
  const [mintResult, setMintResult] = useState(null);
  const [nfts, setNfts] = useState([]);
const [nftsLoading, setNftsLoading] = useState(false);
const [selectedImage, setSelectedImage] = useState(null);

  const isCorrectNetwork = chainId === SEPOLIA_CHAIN_ID;

  const getProvider = () => {
    return new ethers.BrowserProvider(window.ethereum);
  };

  const connectWallet = async () => {
    if (!window.ethereum) {
      setStatus('MetaMask not detected. Please install it.');
      return;
    }

    try {
      const provider = getProvider();

      const accounts = await provider.send('eth_requestAccounts', []);

      const network = await provider.getNetwork();

      setWalletAddress(accounts[0]);
      setChainId(network.chainId);
      setStatus('');
    } catch (err) {
      setStatus('Failed to connect: ' + err.message);
    }
  };

  useEffect(() => {
    if (!window.ethereum) return;

    const handleAccountsChanged = (accounts) => {
      setWalletAddress(
        accounts.length === 0 ? null : accounts[0]
      );
    };

    const handleChainChanged = (newChainIdHex) => {
      setChainId(BigInt(newChainIdHex));
    };

    window.ethereum.on(
      'accountsChanged',
      handleAccountsChanged
    );

    window.ethereum.on(
      'chainChanged',
      handleChainChanged
    );

    return () => {
      window.ethereum.removeListener(
        'accountsChanged',
        handleAccountsChanged
      );

      window.ethereum.removeListener(
        'chainChanged',
        handleChainChanged
      );
    };
  }, []);

  const fetchPrice = async () => {
    if (!window.ethereum) return;

    setPriceLoading(true);

    try {
      const provider = getProvider();

      const contract = new ethers.Contract(
        CONTRACT_ADDRESS,
        CONTRACT_ABI,
        provider
      );

      const rawPrice = await contract.getLatestPrice();

      const formatted = ethers.formatUnits(
        rawPrice,
        8
      );

      setEthPrice(
        Number(formatted).toFixed(2)
      );
    } catch (err) {
      setStatus(
        'Failed to fetch price: ' +
          (err.reason || err.message)
      );
    } finally {
      setPriceLoading(false);
    }
  };

  // Automatically load the current ETH/USD price
  useEffect(() => {
    fetchPrice();
  }, []);

  useEffect(() => {
  loadNFTs();
}, []);

const mintNFT = async () => {
  setMinting(true);
  setMintResult(null);

  try {
    if (!selectedImage) {
      setStatus('Please select an NFT image first.');
      setMinting(false);
      return;
    }

    setStatus('Uploading image to IPFS...');

    const formData = new FormData();
    formData.append('file', selectedImage);

    const { ok: imgOk, data: imageResult } = await safeFetchJson(
      `${BACKEND_URL}/api/upload-image`,
      {
        method: 'POST',
        body: formData,
      }
    );

    if (!imgOk || !imageResult.success) {
      throw new Error(imageResult.error || 'Image upload failed.');
    }

    const imageCid = imageResult.cid;

    setStatus('Image uploaded. Waiting for wallet confirmation...');

    const provider = getProvider();


    const signer = await provider.getSigner();

    const contract = new ethers.Contract(
      CONTRACT_ADDRESS,
      CONTRACT_ABI,
      signer
    );

    const tx = await contract.mint();

      setStatus('Transaction pending...');

      // Wait for blockchain confirmation
      const receipt = await tx.wait();

      // Find NFTMinted event
      const mintedEvent = receipt.logs
        .map((log) => {
          try {
            return contract.interface.parseLog(log);
          } catch {
            return null;
          }
        })
        .find(
          (parsed) =>
            parsed && parsed.name === 'NFTMinted'
        );

      if (!mintedEvent) {
        throw new Error(
          'NFTMinted event not found in transaction receipt'
        );
      }

      const tokenId = mintedEvent.args.tokenId;

      // Price stored in the event at exact mint time
      const mintPriceRaw = mintedEvent.args.price;

      const mintPrice = Number(
        ethers.formatUnits(mintPriceRaw, 8)
      ).toFixed(2);

    const market =
  await contract.getTokenMarket(tokenId);

    setStatus('Creating NFT metadata...');

const { ok: metaOk, data: metadataResult } = await safeFetchJson(
  `${BACKEND_URL}/api/upload-metadata`,
  {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      tokenId: tokenId.toString(),
      market,
      ethUsdPrice: mintPrice,
      imageCid,
    }),
  }
);

if (!metaOk || !metadataResult.success) {
  throw new Error(
    metadataResult.error || 'Metadata upload failed.'
  );
}

const metadataCid = metadataResult.metadataCid;

setStatus('Verifying mint and saving NFT...');

const { ok: verifyOk, data: verifyResult } = await safeFetchJson(
  `${BACKEND_URL}/api/verify-mint`,
  {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      txHash: receipt.hash,
      imageCid,
      metadataCid,
    }),
  }
);

if (!verifyOk || !verifyResult.verified) {
  throw new Error(
    verifyResult.error || 'Mint verification failed.'
  );
}

await loadNFTs();

setMintResult({
        tokenId: tokenId.toString(),
        market,
        priceAtMint: mintPrice,
        txHash: receipt.hash,
      });

      setStatus('Mint successful!');

      // Refresh current price
      fetchPrice();
    } catch (err) {
      if (err.code === 'ACTION_REJECTED') {
        setStatus(
          'Transaction rejected in wallet.'
        );
      } else {
        setStatus(
          'Mint failed: ' +
            (err.reason || err.message)
        );
      }
    } finally {
      setMinting(false);
    }
  };

  const resultMeta = mintResult
    ? MARKET_META[mintResult.market]
    : null;

  return (
    <div className="page">

      {/* ================= NAVBAR ================= */}

      <nav className="navbar">

        <div className="navbar-left">
          <div className="logo-mark">◆</div>

          <span className="navbar-title">
            ChainLinkNFT
          </span>

          <span className="badge badge-network">
            Sepolia Testnet
          </span>
        </div>

        <div className="navbar-right">

          <a
            className="link-etherscan"
            href={`${ETHERSCAN_BASE}/address/${CONTRACT_ADDRESS}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            Contract ↗
          </a>

          {walletAddress ? (
            <div className="wallet-chip">
              <span className="dot-connected" />

              {shortenAddress(walletAddress)}
            </div>
          ) : (
            <button
              className="btn btn-primary btn-small"
              onClick={connectWallet}
            >
              Connect Wallet
            </button>
          )}

        </div>

      </nav>


      {/* ================= MAIN ================= */}

      <main className="content">

        {/* ================= HERO ================= */}

        <section className="hero">

          <div
            className="oracle-visual"
            aria-hidden="true"
          >
            <span className="oracle-ring ring-1" />
            <span className="oracle-ring ring-2" />
            <span className="oracle-ring ring-3" />
            <span className="oracle-node" />
          </div>

          <h1 className="hero-title">
            Mint an NFT powered by{' '}
            <span className="gradient-text">
              Chainlink
            </span>
          </h1>

          <p className="hero-subtitle">
            Your NFT's market trait is determined by
            the live ETH/USD price at mint time.
          </p>

        </section>


        {/* ================= STATS ================= */}

        <section className="stats-row">

          <div className="stat-card">

            <span className="stat-label">
              ETH / USD
            </span>

            <span className="stat-value">
              {priceLoading
                ? '...'
                : ethPrice
                ? `$${ethPrice}`
                : '—'}
            </span>

            <button
              className="stat-refresh"
              onClick={fetchPrice}
              disabled={priceLoading}
            >
              {priceLoading
                ? 'Refreshing...'
                : 'Refresh'}
            </button>

          </div>


          <div className="stat-card">

            <span className="stat-label">
              Network
            </span>

            <span className="stat-value stat-value-small">
              Sepolia
            </span>

          </div>


          <div className="stat-card">

            <span className="stat-label">
              NFT Standard
            </span>

            <span className="stat-value stat-value-small">
              ERC-721
            </span>

          </div>

        </section>


        {/* ================= WALLET ================= */}

        <section className="wallet-panel glass">

          {walletAddress ? (

            <div className="wallet-panel-row">

              <div className="wallet-info">

                <span className="dot-connected" />

                <div>

                  <div className="wallet-info-label">
                    Connected
                  </div>

                  <div className="wallet-info-address">
                    {walletAddress}
                  </div>

                </div>

              </div>

              <span className="badge badge-network">
                Sepolia
              </span>

              {!isCorrectNetwork && (
                <p className="warning-text">
                  Wrong network — switch MetaMask
                  to Sepolia (chain ID 11155111).
                </p>
              )}

            </div>

          ) : (

            <div className="wallet-panel-row wallet-panel-empty">

              <p>
                Connect your wallet to mint a
                ChainLinkNFT.
              </p>

              <button
                className="btn btn-primary"
                onClick={connectWallet}
              >
                Connect Wallet
              </button>

            </div>

          )}

        </section>


        {/* ================= MINT ================= */}

        <section className="mint-card glass">

          <h2 className="mint-title">
            Create your ChainLinkNFT
          </h2>

          <p className="mint-description">
            The NFT captures the current ETH/USD
            market condition permanently at mint.
          </p>

          <div className="image-upload">
  <label htmlFor="nft-image">
    Choose NFT Image
  </label>

  <input
    id="nft-image"
    type="file"
    accept="image/*"
    onChange={(e) => {
      setSelectedImage(e.target.files[0] || null);
    }}
  />

  {selectedImage && (
    <p className="selected-image-name">
      Selected: {selectedImage.name}
    </p>
  )}
</div>

          <button
            className="btn btn-mint"
            onClick={mintNFT}
            disabled={
              !walletAddress ||
              !isCorrectNetwork ||
              minting
            }
          >
            {minting
              ? 'Minting...'
              : 'Mint NFT'}
          </button>

          {status && (
            <p className="status-text">
              {status}
            </p>
          )}

        </section>


        {/* ================= MINT RESULT ================= */}

        {mintResult && resultMeta && (

          <section
            className={`result-card glass market-${resultMeta.className}`}
          >

            {/* NFT ART */}

            <div className="nft-art">

              <div className="nft-art-label">
                CHAINLINK NFT
              </div>

              <div className="nft-art-id">
                #{mintResult.tokenId}
              </div>

              <div className="nft-art-bars">

                <span className="bar bar-1" />
                <span className="bar bar-2" />
                <span className="bar bar-3" />
                <span className="bar bar-4" />
                <span className="bar bar-5" />

              </div>

            </div>


            {/* NFT DETAILS */}

            <div className="result-details">

              <div className="result-row">

                <span className="result-label">
                  Market Condition
                </span>

                <span
                  className={`result-market market-text-${resultMeta.className}`}
                >
                  {resultMeta.emoji}{' '}
                  {resultMeta.label}
                </span>

              </div>


              <div className="result-row">

                <span className="result-label">
                  ETH / USD at Mint
                </span>

                <span className="result-value">
                  ${mintResult.priceAtMint}
                </span>

              </div>


              {/* Etherscan Buttons */}

              <div className="result-actions">

                <a
                  className="btn btn-secondary"
                  href={`${ETHERSCAN_BASE}/tx/${mintResult.txHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  View Transaction
                </a>

                <a
                  className="btn btn-secondary"
                  href={`${ETHERSCAN_BASE}/address/${CONTRACT_ADDRESS}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  View Contract
                </a>

              </div>

            </div>

          </section>

               )}

        {/* ================= NFT GALLERY ================= */}

        <section className="nft-gallery">

          <div className="gallery-header">
            <div>
              <h2 className="gallery-title">
                Your NFT Collection
              </h2>

              <p className="gallery-subtitle">
                NFTs minted through ChainLinkNFT
              </p>
            </div>

            <span className="gallery-count">
              {nfts.length} NFT{nfts.length !== 1 ? 's' : ''}
            </span>
          </div>

          {nftsLoading ? (
            <p className="gallery-status">
              Loading NFTs...
            </p>
          ) : nfts.length === 0 ? (
            <p className="gallery-status">
              No NFTs have been indexed yet.
            </p>
          ) : (
            <div className="nft-grid">

              {nfts.map((nft) => {
                const marketMeta = MARKET_META[nft.market];

                return (
                  <div
                    className="gallery-card"
                    key={nft.id}
                  >

                    <div className="gallery-image-wrapper">
                      <img
                        src={`https://gateway.pinata.cloud/ipfs/${nft.image_cid}`}
                        alt={`ChainLinkNFT #${nft.token_id}`}
                        className="gallery-image"
                      />
                    </div>

                    <div className="gallery-card-content">

                      <div className="gallery-card-title">
                        <h3>
                          ChainLinkNFT #{nft.token_id}
                        </h3>

                        <span
                          className={`gallery-market ${
                            marketMeta?.className || ''
                          }`}
                        >
                          {marketMeta?.emoji} {nft.market}
                        </span>
                      </div>

                      <div className="gallery-info">

                        <div>
                          <span>ETH/USD at Mint</span>
                          <strong>
                            ${Number(nft.eth_usd_price).toFixed(2)}
                          </strong>
                        </div>

                        <div>
                          <span>Owner</span>
                          <strong>
                            {shortenAddress(nft.owner_wallet)}
                          </strong>
                        </div>

                      </div>

                      <div className="gallery-actions">

                        <a
                          href={`https://gateway.pinata.cloud/ipfs/${nft.metadata_cid}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="btn btn-secondary"
                        >
                          Metadata ↗
                        </a>

                        <a
                          href={`${ETHERSCAN_BASE}/tx/${nft.transaction_hash}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="btn btn-secondary"
                        >
                          Transaction ↗
                        </a>

                      </div>

                    </div>

                  </div>
                );
              })}

            </div>
          )}

        </section>

        {/* ================= MARKET INFO ================= */}

        <section className="market-info-row">

          <div className="market-info-card market-bearish">

            <span className="market-info-emoji">
              🐻
            </span>

            <span className="market-info-title">
              Bearish
            </span>

            <span className="market-info-range">
              ETH &lt; $2,500
            </span>

          </div>


          <div className="market-info-card market-neutral">

            <span className="market-info-emoji">
              ⚖️
            </span>

            <span className="market-info-title">
              Neutral
            </span>

            <span className="market-info-range">
              $2,500 – $4,000
            </span>

          </div>


          <div className="market-info-card market-bullish">

            <span className="market-info-emoji">
              🐂
            </span>

            <span className="market-info-title">
              Bullish
            </span>

            <span className="market-info-range">
              ETH &gt; $4,000
            </span>

          </div>

        </section>

      </main>


      {/* ================= FOOTER ================= */}

      <footer className="footer">

        <p>
          Powered by Chainlink • Built on
          Ethereum Sepolia •{' '}

          <a
            href={`${ETHERSCAN_BASE}/address/${CONTRACT_ADDRESS}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            View on Etherscan
          </a>

        </p>

      </footer>

    </div>
  );
}

export default App;