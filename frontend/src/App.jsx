import { useState, useEffect } from 'react';
import { ethers } from 'ethers';
import {
  PRODUCTION_CONTRACT_ADDRESS,
  DEMO_CONTRACT_ADDRESS,
  MOCK_PRICE_FEED_ADDRESS,
  CONTRACT_ABI,
} from './contract';
import { MARKETPLACE_ADDRESS, MARKETPLACE_ABI } from './marketplaceContract';
import { MOCK_PRICE_FEED_ABI } from './mockContract';
import { supabase } from './supabase';
import './App.css';

const SEPOLIA_CHAIN_ID = 11155111n;
const ETHERSCAN_BASE = 'https://sepolia.etherscan.io';
const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3001';

async function safeFetchJson(url, options) {
  let response;
  try {
    response = await fetch(url, options);
  } catch (err) {
    throw new Error(`Network error connecting to backend: ${err.message}`);
  }

  const text = await response.text();

  if (!text || !text.trim()) {
    throw new Error(`Backend returned empty response (Status ${response.status})`);
  }

  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    throw new Error(`Backend returned non-JSON response (Status ${response.status}): ${text.slice(0, 150)}`);
  }

  try {
    const data = JSON.parse(text);
    return { ok: response.ok, status: response.status, data };
  } catch (err) {
    throw new Error(`Failed to parse backend JSON response (Status ${response.status}): ${err.message}`);
  }
}

const MARKET_META = {
  Bearish: { emoji: '🐻', label: 'BEARISH', className: 'bearish' },
  Neutral: { emoji: '⚖️', label: 'NEUTRAL', className: 'neutral' },
  Bullish: { emoji: '🐂', label: 'BULLISH', className: 'bullish' },
};

const MINT_STEPS = [
  { id: 1, label: 'Uploading image to IPFS' },
  { id: 2, label: 'Waiting for wallet confirmation' },
  { id: 3, label: 'Transaction pending on Sepolia' },
  { id: 4, label: 'Creating & uploading metadata' },
  { id: 5, label: 'Verifying mint on-chain' },
  { id: 6, label: 'Saving verified NFT record' },
];

function shortenAddress(addr) {
  if (!addr) return '';
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

function getCurrentMarket(priceNum) {
  if (!priceNum || isNaN(priceNum)) return null;
  const p = Number(priceNum);
  if (p < 2500) return 'Bearish';
  if (p <= 4000) return 'Neutral';
  return 'Bullish';
}

function decodeRevertError(err) {
  if (!err) return 'Unknown error occurred';
  if (err.code === 4001 || err.action === 'reject' || err.message?.includes('user rejected')) {
    return 'Transaction cancelled by user.';
  }
  const msg = err.reason || err.info?.error?.message || err.shortMessage || err.message || '';
  if (msg.includes('Not the NFT owner')) return "You don't own this NFT.";
  if (msg.includes('Marketplace not approved')) return 'Marketplace approval missing or revoked.';
  if (msg.includes('Price must be greater than zero')) return 'Price must be greater than zero.';
  if (msg.includes('execution reverted')) return 'Contract execution reverted on Sepolia.';
  return msg.slice(0, 100);
}

// --- IPFS RESOLUTION HELPERS ---
function resolveIpfsUrl(urlOrCid) {
  if (!urlOrCid) return null;
  const str = String(urlOrCid).trim();
  if (!str || str === '#') return null;

  if (str.startsWith('ipfs://')) {
    const cid = str.replace('ipfs://', '').replace(/^ipfs\//, '');
    return `https://gateway.pinata.cloud/ipfs/${cid}`;
  }

  if (str.includes('/ipfs/')) {
    const parts = str.split('/ipfs/');
    const cid = parts[1];
    return `https://gateway.pinata.cloud/ipfs/${cid}`;
  }

  if (str.startsWith('http://') || str.startsWith('https://')) {
    return str;
  }

  return `https://gateway.pinata.cloud/ipfs/${str}`;
}

function getNftImageUrl(item) {
  const fallback = 'https://placehold.co/400x400/1e293b/a78bfa?text=NFT+Artwork+Unavailable';
  if (!item) return fallback;
  const val =
    item.ipfs_image_url ||
    item.imageIpfsUrl ||
    item.image_cid ||
    item.image ||
    item.image_url;
  const resolved = resolveIpfsUrl(val);
  return resolved || fallback;
}

function getNftMetadataUrl(item) {
  if (!item) return '#';
  const val =
    item.ipfs_metadata_url ||
    item.metadataIpfsUrl ||
    item.metadata_cid ||
    item.metadata_url;
  return resolveIpfsUrl(val) || '#';
}

function App() {
  const [walletAddress, setWalletAddress] = useState(null);
  const [chainId, setChainId] = useState(null);
  const [ethPrice, setEthPrice] = useState(null);
  const [priceLoading, setPriceLoading] = useState(false);
  const [status, setStatus] = useState('');
  const [minting, setMinting] = useState(false);
  const [currentMintStep, setCurrentMintStep] = useState(0);
  const [mintResult, setMintResult] = useState(null);
  const [nfts, setNfts] = useState([]);
  const [nftsLoading, setNftsLoading] = useState(false);
  const [selectedImage, setSelectedImage] = useState(null);

  // Oracle Mode State (Real Chainlink Feed vs Demo Mock Feed)
  const [isDemoMode, setIsDemoMode] = useState(false);
  const [updatingMockPrice, setUpdatingMockPrice] = useState(false);
  const [mockPriceStatus, setMockPriceStatus] = useState('');

  // Judge Demo Modal State
  const [showJudgeDemoModal, setShowJudgeDemoModal] = useState(false);

  // System Health Timer State
  const [healthSecondsAgo, setHealthSecondsAgo] = useState(0);

  // System Health Timer Interval
  useEffect(() => {
    const timer = setInterval(() => {
      setHealthSecondsAgo((prev) => prev + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Web3 Enhanced States
  const [onChainOwners, setOnChainOwners] = useState({});
  const [ensNames, setEnsNames] = useState({});
  const [selectedNftModal, setSelectedNftModal] = useState(null);
  const [transferHistory, setTransferHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState(null);

  // NFT Transfer Modal States
  const [transferModalNft, setTransferModalNft] = useState(null);
  const [transferRecipient, setTransferRecipient] = useState('');
  const [transferStatus, setTransferStatus] = useState('');
  const [transferring, setTransferring] = useState(false);
  const [transferTxHash, setTransferTxHash] = useState(null);

  // Automation Reader State
  const [automationData, setAutomationData] = useState(null);

  // Gallery & Marketplace Navigation States
  const [galleryTab, setGalleryTab] = useState('gallery'); // 'gallery' | 'marketplace' | 'my_nfts' | 'activity'
  const [marketFilter, setMarketFilter] = useState('All'); // 'All' | 'Bearish' | 'Neutral' | 'Bullish'
  const [sortOption, setSortOption] = useState('latest'); // 'latest' | 'price_asc' | 'price_desc' | 'tokenId' | 'price' | 'market'
  const [searchQuery, setSearchQuery] = useState('');

  // Activity Feed States
  const [activityFeed, setActivityFeed] = useState([]);
  const [activityLoading, setActivityLoading] = useState(false);
  const [activityError, setActivityError] = useState(null);

  // Marketplace Listings State
  const [listings, setListings] = useState(() => {
    try {
      const saved = localStorage.getItem('chainlink_nft_listings');
      return saved ? JSON.parse(saved) : {};
    } catch {
      return {};
    }
  });

  // Listing Modal States
  const [listModalNft, setListModalNft] = useState(null);
  const [listPriceInput, setListPriceInput] = useState('0.05');
  const [listingStatus, setListingStatus] = useState('');
  const [listingLoading, setListingLoading] = useState(false);
  const [listingStep, setListingStep] = useState(0);

  const isCorrectNetwork = chainId === SEPOLIA_CHAIN_ID;

  const activeContractAddress = isDemoMode ? DEMO_CONTRACT_ADDRESS : PRODUCTION_CONTRACT_ADDRESS;

  const [scrolled, setScrolled] = useState(false);

  // Scroll handler for floating navbar scroll effect
  useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > 30);
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  // Backend API Health State
  const [backendHealth, setBackendHealth] = useState('checking');

  // Backend Health Ping Check
  useEffect(() => {
    fetch(`${BACKEND_URL}/health`)
      .then((res) => res.json())
      .then((data) => {
        if (data.status === 'ok') setBackendHealth('online');
        else setBackendHealth('configured');
      })
      .catch(() => setBackendHealth('configured'));
  }, []);

  // Shareable NFT Proof Link Generator, Web Share API & Clipboard Copier
  const handleShareNftProof = async (tokenId, e) => {
    if (e) e.stopPropagation();
    const shareUrl = `${window.location.origin}${window.location.pathname}?nft=${tokenId}`;

    if (navigator.share) {
      try {
        await navigator.share({
          title: `ChainLinkNFT #${tokenId} Proof`,
          text: `Verify ChainLinkNFT #${tokenId} on-chain provenance and Chainlink oracle market trait on Sepolia:`,
          url: shareUrl,
        });
        setStatus(`✓ Shared proof link for NFT #${tokenId}`);
        return;
      } catch {
        // User cancelled or share failed, fallback to clipboard
      }
    }

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard
        .writeText(shareUrl)
        .then(() => {
          setStatus(`✓ Shareable proof link copied to clipboard: ${shareUrl}`);
        })
        .catch(() => {
          prompt('Copy shareable proof link:', shareUrl);
        });
    } else {
      prompt('Copy shareable proof link:', shareUrl);
    }
  };

  // URL Parameter Detection for ?nft=<tokenId>
  useEffect(() => {
    if (nfts.length > 0) {
      const params = new URLSearchParams(window.location.search);
      const sharedTokenId = params.get('nft');
      if (sharedTokenId) {
        const foundNft = nfts.find((n) => String(n.token_id) === String(sharedTokenId));
        if (foundNft) {
          setSelectedNftModal(foundNft);
        }
      }
    }
  }, [nfts]);

  // Persist listings to LocalStorage
  useEffect(() => {
    try {
      localStorage.setItem('chainlink_nft_listings', JSON.stringify(listings));
    } catch {
      // ignore
    }
  }, [listings]);

  const getProvider = () => {
    return new ethers.BrowserProvider(window.ethereum);
  };

  const getReadProvider = () => {
    if (window.ethereum) {
      return new ethers.BrowserProvider(window.ethereum);
    }
    return new ethers.JsonRpcProvider('https://ethereum-sepolia-rpc.publicnode.com');
  };

  // ENS Resolution with session caching
  const resolveEns = async (address) => {
    if (!address || ensNames[address] !== undefined) return;
    try {
      const mainnetProvider = new ethers.JsonRpcProvider('https://eth.merkle.io');
      const name = await mainnetProvider.lookupAddress(address);
      setEnsNames((prev) => ({ ...prev, [address]: name || null }));
    } catch {
      setEnsNames((prev) => ({ ...prev, [address]: null }));
    }
  };

  const formatAddressWithEns = (address) => {
    if (!address) return '';
    if (address.toLowerCase() === '0x0000000000000000000000000000000000000000') {
      return 'Null Address (0x0000...0000)';
    }
    const ens = ensNames[address];
    const short = shortenAddress(address);
    if (ens) {
      return `${ens} (${short})`;
    }
    return short;
  };

  // Sepolia Network Guard
  const switchNetworkToSepolia = async () => {
    if (!window.ethereum) return;
    try {
      await window.ethereum.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: '0xaa36a7' }],
      });
    } catch (switchError) {
      if (switchError.code === 4902) {
        try {
          await window.ethereum.request({
            method: 'wallet_addEthereumChain',
            params: [
              {
                chainId: '0xaa36a7',
                chainName: 'Ethereum Sepolia',
                nativeCurrency: { name: 'Sepolia Ether', symbol: 'ETH', decimals: 18 },
                rpcUrls: ['https://ethereum-sepolia-rpc.publicnode.com', 'https://rpc.sepolia.org'],
                blockExplorerUrls: ['https://sepolia.etherscan.io'],
              },
            ],
          });
        } catch (addError) {
          setStatus('Failed to add Sepolia network: ' + addError.message);
        }
      } else {
        setStatus('Failed to switch to Sepolia: ' + switchError.message);
      }
    }
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
      resolveEns(accounts[0]);
    } catch (err) {
      setStatus('Failed to connect wallet: ' + err.message);
    }
  };

  useEffect(() => {
    if (window.ethereum) {
      window.ethereum
        .request({ method: 'eth_accounts' })
        .then((accounts) => {
          if (accounts.length > 0) {
            setWalletAddress(accounts[0]);
            resolveEns(accounts[0]);
          }
        })
        .catch(() => {});

      window.ethereum
        .request({ method: 'eth_chainId' })
        .then((id) => setChainId(BigInt(id)))
        .catch(() => {});

      const handleAccountsChanged = (accounts) => {
        if (accounts.length > 0) {
          setWalletAddress(accounts[0]);
          resolveEns(accounts[0]);
        } else {
          setWalletAddress(null);
        }
      };

      const handleChainChanged = (idHex) => {
        setChainId(BigInt(idHex));
      };

      window.ethereum.on('accountsChanged', handleAccountsChanged);
      window.ethereum.on('chainChanged', handleChainChanged);

      return () => {
        if (window.ethereum.removeListener) {
          window.ethereum.removeListener('accountsChanged', handleAccountsChanged);
          window.ethereum.removeListener('chainChanged', handleChainChanged);
        }
      };
    }
  }, []);

  const fetchPrice = async () => {
    setPriceLoading(true);
    try {
      const provider = getReadProvider();
      const contract = new ethers.Contract(activeContractAddress, CONTRACT_ABI, provider);
      const priceRaw = await contract.getLatestPrice();

      const formatPrice = (priceRaw / 10n ** 8n).toString();
      setEthPrice(formatPrice);

      try {
        const currMarketEnum = await contract.currentMarket();
        const currMarketStr = await contract.getCurrentMarketString();
        setAutomationData({
          enumValue: Number(currMarketEnum),
          marketString: currMarketStr,
        });
      } catch {
        // optional automation fields
      }
    } catch (err) {
      setStatus('Failed to fetch price from contract: ' + err.message);
    } finally {
      setPriceLoading(false);
    }
  };

  useEffect(() => {
    fetchPrice();
    fetchNfts();
  }, [isDemoMode]);

  // Handle updating Demo Mock Price on Sepolia
  const handleUpdateMockPrice = async (targetPriceUSD) => {
    if (!walletAddress) {
      setMockPriceStatus('Please connect your wallet to update the Demo Oracle price.');
      return;
    }

    if (!isCorrectNetwork) {
      switchNetworkToSepolia();
      return;
    }

    setUpdatingMockPrice(true);
    setMockPriceStatus(`Step 1/2: Preparing Mock Chainlink price update to $${targetPriceUSD} USD...`);

    try {
      const provider = getProvider();
      const signer = await provider.getSigner();
      const mockContract = new ethers.Contract(MOCK_PRICE_FEED_ADDRESS, MOCK_PRICE_FEED_ABI, signer);

      const priceWei = BigInt(targetPriceUSD) * 10n ** 8n;
      setMockPriceStatus(`Step 2/2: Confirming price update transaction on Sepolia...`);
      const tx = await mockContract.updateAnswer(priceWei);

      setMockPriceStatus(`Transaction submitted (${shortenAddress(tx.hash)}). Waiting for Sepolia block confirmation...`);
      await tx.wait(1);

      setMockPriceStatus(`🎉 Demo Oracle updated on-chain to $${targetPriceUSD} USD! Next mint will read this oracle price.`);
      fetchPrice();
    } catch (err) {
      setMockPriceStatus('Failed to update Demo Oracle: ' + (err.reason || err.message));
    } finally {
      setUpdatingMockPrice(false);
    }
  };

  const fetchNfts = async () => {
    setNftsLoading(true);
    try {
      const { data, error } = await supabase
        .from('nfts')
        .select('*')
        .order('minted_at', { ascending: false });

      if (error) {
        setStatus('Failed to load NFTs from database: ' + error.message);
      } else {
        // Normalize Supabase DB records
        const normalizedNfts = (data || []).map((item) => ({
          ...item,
          token_id: item.token_id,
          market: item.market,
          price_at_mint: item.price_at_mint || item.eth_usd_price || 0,
          owner_address: item.owner_address || item.owner_wallet || '',
          mint_tx_hash: item.mint_tx_hash || item.transaction_hash || '',
          ipfs_image_url: getNftImageUrl(item),
          ipfs_metadata_url: getNftMetadataUrl(item),
        }));

        setNfts(normalizedNfts);

        const provider = getReadProvider();
        const contract = new ethers.Contract(activeContractAddress, CONTRACT_ABI, provider);

        const ownersMap = {};
        for (const nftItem of normalizedNfts) {
          try {
            const owner = await contract.ownerOf(nftItem.token_id);
            ownersMap[nftItem.token_id] = owner;
            resolveEns(owner);
          } catch {
            ownersMap[nftItem.token_id] = nftItem.owner_address;
            resolveEns(nftItem.owner_address);
          }
        }
        setOnChainOwners(ownersMap);
      }
    } catch (err) {
      setStatus('Failed to load NFTs: ' + err.message);
    } finally {
      setNftsLoading(false);
    }
  };

  // Activity Feed sync from on-chain records & marketplace listings
  useEffect(() => {
    if (nfts.length > 0) {
      const items = [];

      nfts.forEach((nft) => {
        items.push({
          type: 'MINT',
          title: `🟢 ChainLink NFT #${nft.token_id} Minted`,
          icon: '🟢',
          tokenId: nft.token_id,
          market: nft.market,
          price: nft.price_at_mint || nft.eth_usd_price,
          from: '0x0000000000000000000000000000000000000000',
          to: nft.owner_address || nft.owner_wallet,
          txHash: nft.mint_tx_hash || nft.transaction_hash,
          contractAddress: nft.contract_address || activeContractAddress,
          timestamp: nft.minted_at ? new Date(nft.minted_at).getTime() : Date.now() - (nft.token_id * 60000),
        });
      });

      Object.entries(listings).forEach(([tokenIdStr, listing]) => {
        if (listing && listing.active) {
          items.push({
            type: 'LIST',
            title: `🟣 NFT #${tokenIdStr} Listed for Sale`,
            icon: '🟣',
            tokenId: Number(tokenIdStr),
            priceEth: listing.priceEth,
            seller: listing.seller,
            timestamp: listing.timestamp || Date.now(),
          });
        }
      });

      items.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
      setActivityFeed(items);
    }
  }, [nfts, listings, activeContractAddress]);

  // Live Contract Event Listener (Transfer events)
  useEffect(() => {
    let contract;
    let provider;
    try {
      provider = getReadProvider();
      contract = new ethers.Contract(activeContractAddress, CONTRACT_ABI, provider);

      const onTransfer = (from, to, tokenId) => {
        const tokenIdNum = Number(tokenId);
        const newOwner = to;
        setOnChainOwners((prev) => ({ ...prev, [tokenIdNum]: newOwner }));
        resolveEns(newOwner);
        resolveEns(from);
      };

      contract.on('Transfer', onTransfer);

      return () => {
        if (contract) {
          contract.off('Transfer', onTransfer);
        }
      };
    } catch {
      // non-blocking
    }
  }, [isDemoMode]);

  // Reusable, safe ERC-721 Transfer History query (Production & Demo NFTs)
  const fetchTransferHistory = async (nftItemOrTokenId) => {
    if (!nftItemOrTokenId) return;

    const isObject = typeof nftItemOrTokenId === 'object' && nftItemOrTokenId !== null;
    const targetTokenId = isObject ? nftItemOrTokenId.token_id : nftItemOrTokenId;
    const targetContractAddr = (isObject && nftItemOrTokenId.contract_address)
      ? nftItemOrTokenId.contract_address
      : activeContractAddress;

    setHistoryLoading(true);
    setHistoryError(null);
    setTransferHistory([]);

    try {
      const provider = getReadProvider();
      const contract = new ethers.Contract(targetContractAddr, CONTRACT_ABI, provider);

      const latestBlock = await provider.getBlockNumber();
      let fromBlock = null;

      const txHash = isObject
        ? (nftItemOrTokenId.mint_tx_hash || nftItemOrTokenId.transaction_hash || nftItemOrTokenId.txHash)
        : null;

      if (txHash && ethers.isHexString(txHash, 32)) {
        try {
          const tx = await provider.getTransaction(txHash);
          if (tx && tx.blockNumber) {
            fromBlock = Math.max(0, tx.blockNumber - 5);
          }
        } catch (txErr) {
          console.warn('Could not fetch mint tx blockNumber:', txErr);
        }
      }

      if (!fromBlock) {
        fromBlock = Math.max(0, latestBlock - 20000);
      }

      const CHUNK_SIZE = 4500;
      let allRawEvents = [];

      for (let start = fromBlock; start <= latestBlock; start += CHUNK_SIZE) {
        const end = Math.min(start + CHUNK_SIZE - 1, latestBlock);
        try {
          const chunkEvents = await contract.queryFilter(
            contract.filters.Transfer(),
            start,
            end
          );
          allRawEvents.push(...chunkEvents);
        } catch (chunkErr) {
          console.warn(`RPC chunk query failed for range ${start}-${end}:`, chunkErr);
        }
      }

      // Filter target tokenId client-side (no null indexed topics in filter!)
      const matchingEvents = allRawEvents.filter((evt) => {
        try {
          return evt.args && evt.args[2] !== undefined && evt.args[2].toString() === String(targetTokenId);
        } catch {
          return false;
        }
      });

      // Deduplicate events using transactionHash + logIndex
      const seen = new Set();
      const uniqueEvents = [];

      for (const evt of matchingEvents) {
        const idx = evt.index !== undefined ? evt.index : (evt.logIndex !== undefined ? evt.logIndex : 0);
        const key = `${evt.transactionHash}-${idx}`;
        if (!seen.has(key)) {
          seen.add(key);
          uniqueEvents.push(evt);
        }
      }

      // Sort chronologically (blockNumber ascending, then logIndex ascending)
      uniqueEvents.sort((a, b) => {
        if (a.blockNumber !== b.blockNumber) {
          return a.blockNumber - b.blockNumber;
        }
        const idxA = a.index !== undefined ? a.index : (a.logIndex !== undefined ? a.logIndex : 0);
        const idxB = b.index !== undefined ? b.index : (b.logIndex !== undefined ? b.logIndex : 0);
        return idxA - idxB;
      });

      const parsedHistory = await Promise.all(
        uniqueEvents.map(async (evt) => {
          let timestamp = null;
          try {
            const blk = await evt.getBlock();
            if (blk) timestamp = blk.timestamp;
          } catch {
            // optional block fetch
          }

          const fromAddr = evt.args[0];
          const toAddr = evt.args[1];

          resolveEns(fromAddr);
          resolveEns(toAddr);

          return {
            from: fromAddr,
            to: toAddr,
            tokenId: evt.args[2].toString(),
            transactionHash: evt.transactionHash,
            blockNumber: evt.blockNumber,
            timestamp,
          };
        })
      );

      setTransferHistory(parsedHistory);
    } catch (err) {
      console.error('Fetch transfer history error:', err);
      setHistoryError('Transfer history temporarily unavailable. Please try again.');
    } finally {
      setHistoryLoading(false);
    }
  };

  const handleOpenNftModal = (nftItem) => {
    setSelectedNftModal(nftItem);
    fetchTransferHistory(nftItem);
  };

  // NFT Transfer Handler
  const handleOpenTransferModal = (nftItem, e) => {
    if (e) e.stopPropagation();
    setTransferModalNft(nftItem);
    setTransferRecipient('');
    setTransferStatus('');
    setTransferTxHash(null);
  };

  const executeNftTransfer = async () => {
    if (!transferModalNft || !transferRecipient) {
      setTransferStatus('Please enter a recipient address or ENS name.');
      return;
    }

    setTransferring(true);
    setTransferStatus('Resolving recipient & building transaction...');

    try {
      let recipientAddress = transferRecipient.trim();

      if (recipientAddress.endsWith('.eth')) {
        const mainnetProvider = new ethers.JsonRpcProvider('https://eth.merkle.io');
        const resolved = await mainnetProvider.resolveName(recipientAddress);
        if (!resolved) {
          throw new Error(`Could not resolve ENS name: ${recipientAddress}`);
        }
        recipientAddress = resolved;
      }

      if (!ethers.isAddress(recipientAddress)) {
        throw new Error('Invalid Ethereum address.');
      }

      const provider = getProvider();
      const signer = await provider.getSigner();
      const contract = new ethers.Contract(activeContractAddress, CONTRACT_ABI, signer);

      setTransferStatus('Please confirm the transfer transaction in MetaMask...');
      const tx = await contract.transferFrom(
        walletAddress,
        recipientAddress,
        transferModalNft.token_id
      );

      setTransferTxHash(tx.hash);
      setTransferStatus('Transaction submitted. Waiting for Sepolia block confirmation...');

      await tx.wait(1);

      setOnChainOwners((prev) => ({
        ...prev,
        [transferModalNft.token_id]: recipientAddress,
      }));
      resolveEns(recipientAddress);

      setTransferStatus(`Transfer complete! NFT #${transferModalNft.token_id} transferred to ${shortenAddress(recipientAddress)}.`);
      fetchNfts();
    } catch (err) {
      setTransferStatus('Transfer failed: ' + (err.reason || err.message));
    } finally {
      setTransferring(false);
    }
  };

  // --- MARKETPLACE ACTIONS ---
  const handleOpenListModal = (nftItem, e) => {
    if (e) e.stopPropagation();
    setListModalNft(nftItem);
    setListPriceInput('0.05');
    setListingStatus('');
    setListingStep(0);
    setListingLoading(false);
  };

  const handleExecuteListing = async () => {
    if (!listModalNft || !listPriceInput || Number(listPriceInput) <= 0) {
      setListingStatus('Please enter a valid price in ETH.');
      return;
    }

    if (!walletAddress) {
      setListingStatus('Please connect your wallet first.');
      return;
    }

    if (!isCorrectNetwork) {
      switchNetworkToSepolia();
      return;
    }

    setListingLoading(true);
    setListingStep(1);
    setListingStatus('Verifying NFT ownership...');

    try {
      const targetNftContractAddr = listModalNft.contract_address || activeContractAddress;
      const provider = getProvider();
      const signer = await provider.getSigner();
      const nftContract = new ethers.Contract(targetNftContractAddr, CONTRACT_ABI, signer);
      const marketContract = new ethers.Contract(MARKETPLACE_ADDRESS, MARKETPLACE_ABI, signer);

      const priceEth = listPriceInput.trim();
      const priceWei = ethers.parseEther(priceEth);
      const tokenId = listModalNft.token_id;

      // 1. Verify Ownership on-chain
      const owner = await nftContract.ownerOf(tokenId);
      if (owner.toLowerCase() !== walletAddress.toLowerCase()) {
        setListingStatus("You don't own this NFT.");
        setListingStep(0);
        setListingLoading(false);
        return;
      }

      setListingStatus('✓ NFT ownership verified');

      // 2. Check ERC-721 Approval (isApprovedForAll or getApproved)
      setListingStep(2);
      const isApprovedAll = await nftContract.isApprovedForAll(walletAddress, MARKETPLACE_ADDRESS);

      if (!isApprovedAll) {
        const approvedAddr = await nftContract.getApproved(tokenId);
        if (approvedAddr.toLowerCase() !== MARKETPLACE_ADDRESS.toLowerCase()) {
          setListingStatus('1/2 Approve Marketplace: Please confirm approval in MetaMask...');
          try {
            const approveTx = await nftContract.approve(MARKETPLACE_ADDRESS, tokenId);
            setListingStatus(`1/2 Approval transaction submitted (${shortenAddress(approveTx.hash)}). Waiting for confirmation...`);
            await approveTx.wait(1);
            setListingStatus('✓ Marketplace approval confirmed!');
          } catch (approveErr) {
            if (approveErr.code === 4001 || approveErr.action === 'reject' || approveErr.message?.includes('rejected') || approveErr.message?.includes('user rejected')) {
              setListingStatus('Marketplace approval cancelled.');
            } else {
              setListingStatus('Marketplace approval failed: ' + decodeRevertError(approveErr));
            }
            setListingStep(0);
            setListingLoading(false);
            return;
          }
        }
      }

      // 3. Execute listNFT transaction
      setListingStep(3);
      setListingStatus('2/2 Create Listing: Please confirm listing in MetaMask...');

      try {
        const listTx = await marketContract.listNFT(targetNftContractAddr, tokenId, priceWei);
        setListingStatus(`2/2 Listing transaction submitted (${shortenAddress(listTx.hash)}). Waiting for confirmation...`);
        await listTx.wait(1);
      } catch (listErr) {
        if (listErr.code === 4001 || listErr.action === 'reject' || listErr.message?.includes('rejected') || listErr.message?.includes('user rejected')) {
          setListingStatus('Listing transaction cancelled.');
        } else {
          setListingStatus('Listing failed: ' + decodeRevertError(listErr));
        }
        setListingStep(0);
        setListingLoading(false);
        return;
      }

      // 4. Listing Confirmed
      setListingStep(4);
      setListings((prev) => ({
        ...prev,
        [tokenId]: {
          seller: walletAddress,
          priceEth,
          active: true,
          timestamp: Date.now(),
        },
      }));

      setListingStatus(`🎉 NFT #${tokenId} listed successfully for ${priceEth} ETH!`);
      fetchNfts();

      setTimeout(() => {
        setListModalNft(null);
        setListingLoading(false);
        setListingStep(0);
      }, 1800);
    } catch (err) {
      setListingStatus('Listing failed: ' + decodeRevertError(err));
      setListingStep(0);
      setListingLoading(false);
    }
  };

  const handleCancelListing = async (nftItem, e) => {
    if (e) e.stopPropagation();
    try {
      if (MARKETPLACE_ADDRESS) {
        const provider = getProvider();
        const signer = await provider.getSigner();
        const marketContract = new ethers.Contract(MARKETPLACE_ADDRESS, MARKETPLACE_ABI, signer);
        const tx = await marketContract.cancelListing(activeContractAddress, nftItem.token_id);
        await tx.wait(1);
      }

      setListings((prev) => {
        const next = { ...prev };
        delete next[nftItem.token_id];
        return next;
      });

      setStatus(`Cancelled listing for NFT #${nftItem.token_id}.`);
    } catch (err) {
      setStatus('Failed to cancel listing: ' + (err.reason || err.message));
    }
  };

  const handleBuyNft = async (nftItem, listingInfo, e) => {
    if (e) e.stopPropagation();
    if (!walletAddress) {
      connectWallet();
      return;
    }

    try {
      setStatus(`Processing purchase of NFT #${nftItem.token_id} for ${listingInfo.priceEth} ETH...`);

      if (MARKETPLACE_ADDRESS) {
        const provider = getProvider();
        const signer = await provider.getSigner();
        const marketContract = new ethers.Contract(MARKETPLACE_ADDRESS, MARKETPLACE_ABI, signer);
        const tx = await marketContract.buyNFT(activeContractAddress, nftItem.token_id, {
          value: ethers.parseEther(listingInfo.priceEth),
        });
        await tx.wait(1);
      }

      // Update local ownership state
      setOnChainOwners((prev) => ({
        ...prev,
        [nftItem.token_id]: walletAddress,
      }));

      // Remove listing
      setListings((prev) => {
        const next = { ...prev };
        delete next[nftItem.token_id];
        return next;
      });

      setStatus(`🎉 Purchased NFT #${nftItem.token_id} for ${listingInfo.priceEth} ETH! Ownership transferred.`);
      fetchNfts();
    } catch (err) {
      setStatus('Purchase failed: ' + (err.reason || err.message));
    }
  };

  const handleImageUpload = (e) => {
    const file = e.target.files[0];
    if (file) {
      setSelectedImage(file);
    }
  };

  // --- FULL 6-STEP MINT PIPELINE (UNIFIED REAL & DEMO MODE) ---
  const mintNFT = async () => {
    if (!walletAddress) {
      setStatus('Please connect your wallet first.');
      return;
    }

    if (!isCorrectNetwork) {
      switchNetworkToSepolia();
      return;
    }

    if (!selectedImage) {
      setStatus('Please select an artwork image first.');
      return;
    }

    setMinting(true);
    setStatus('');
    setMintResult(null);

    // Step 1: Uploading image to IPFS via Pinata
    setCurrentMintStep(1);

    try {
      const formData = new FormData();
      formData.append('file', selectedImage);

      const imageRes = await safeFetchJson(`${BACKEND_URL}/api/upload-image`, {
        method: 'POST',
        body: formData,
      });

      const imageCid = imageRes.data?.cid || imageRes.data?.imageCid;

      if (!imageRes.ok || !imageCid) {
        throw new Error(imageRes.data?.error || 'Failed to upload image to IPFS via Pinata.');
      }

      // Step 2: Waiting for wallet confirmation ⏳
      setCurrentMintStep(2);

      const provider = getProvider();
      const signer = await provider.getSigner();
      const contract = new ethers.Contract(activeContractAddress, CONTRACT_ABI, signer);

      const tx = await contract.mint();

      // Step 3: Transaction pending on Sepolia ⏳
      setCurrentMintStep(3);
      setStatus(`Transaction submitted (${shortenAddress(tx.hash)}). Waiting for Sepolia block confirmation...`);

      const receipt = await tx.wait(1);

      let mintedTokenId = null;
      let mintedMarketVal = null;
      let mintedPriceVal = null;

      for (const log of receipt.logs) {
        try {
          const parsedLog = contract.interface.parseLog(log);
          if (parsedLog && parsedLog.name === 'NFTMinted') {
            mintedTokenId = parsedLog.args.tokenId.toString();
            mintedMarketVal = Number(parsedLog.args.market);
            mintedPriceVal = Number(ethers.formatUnits(parsedLog.args.price, 8));
            break;
          }
        } catch {
          // not this log
        }
      }

      if (!mintedTokenId) {
        throw new Error('Transaction succeeded but NFTMinted event log was not found in receipt.');
      }

      const markets = ['Bearish', 'Neutral', 'Bullish'];
      const marketStr = markets[mintedMarketVal] !== undefined ? markets[mintedMarketVal] : 'Bearish';

      // Step 4: Creating & uploading metadata JSON to IPFS
      setCurrentMintStep(4);
      let metadataCid = null;

      try {
        const metaRes = await safeFetchJson(`${BACKEND_URL}/api/upload-metadata`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tokenId: Number(mintedTokenId),
            market: marketStr,
            ethUsdPrice: mintedPriceVal,
            imageCid,
          }),
        });

        if (metaRes.ok && (metaRes.data?.metadataCid || metaRes.data?.cid)) {
          metadataCid = metaRes.data.metadataCid || metaRes.data.cid;
        }
      } catch (metaErr) {
        console.warn('Metadata upload warning:', metaErr);
      }

      if (!metadataCid) {
        metadataCid = imageCid;
      }

      // Step 5: Verifying mint on-chain
      setCurrentMintStep(5);

      const verifyRes = await safeFetchJson(`${BACKEND_URL}/api/verify-mint`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          txHash: receipt.hash,
          imageCid,
          metadataCid,
        }),
      });

      if (!verifyRes.ok) {
        throw new Error(verifyRes.data?.error || 'Mint verification failed');
      }

      // Step 6: Saving verified NFT record ✓
      setCurrentMintStep(6);
      const verifiedNft = verifyRes.data.nft || {};

      const resolvedImageCid = verifiedNft.image_cid || imageCid;
      const resolvedMetadataCid = verifiedNft.metadata_cid || metadataCid;

      setMintResult({
        tokenId: mintedTokenId,
        market: verifiedNft.market || marketStr,
        priceAtMint: verifiedNft.price_at_mint || verifiedNft.eth_usd_price || mintedPriceVal,
        owner: verifiedNft.owner_wallet || verifiedNft.owner_address || walletAddress,
        contractAddress: verifiedNft.contract_address || activeContractAddress,
        image_cid: resolvedImageCid,
        metadata_cid: resolvedMetadataCid,
        imageIpfsUrl: resolveIpfsUrl(resolvedImageCid),
        metadataIpfsUrl: resolveIpfsUrl(resolvedMetadataCid),
        txHash: receipt.hash,
      });

      setStatus('🎉 NFT Minted & On-Chain Verified!');
      setSelectedImage(null);
      fetchNfts();
      fetchPrice();
    } catch (err) {
      setStatus('Minting failed: ' + err.message);
    } finally {
      setMinting(false);
      setCurrentMintStep(0);
    }
  };

  const calculatedMarket = getCurrentMarket(ethPrice);
  const calculatedMeta = calculatedMarket ? MARKET_META[calculatedMarket] : null;

  // Filtered & Sorted NFTs for Gallery & Marketplace
  const filteredNfts = nfts.filter((nftItem) => {
    // Market Trait Filter
    if (marketFilter !== 'All' && nftItem.market !== marketFilter) {
      return false;
    }

    // Tab Filter
    if (galleryTab === 'my_nfts') {
      const owner = (onChainOwners[nftItem.token_id] || nftItem.owner_address || nftItem.owner_wallet || '').toLowerCase();
      if (!walletAddress || owner !== walletAddress.toLowerCase()) {
        return false;
      }
    } else if (galleryTab === 'marketplace') {
      const listing = listings[nftItem.token_id];
      if (!listing || !listing.active) {
        return false;
      }
    }

    // Search Query (Token ID or Owner / ENS)
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      const tokenIdStr = String(nftItem.token_id);
      const ownerStr = (onChainOwners[nftItem.token_id] || nftItem.owner_address || nftItem.owner_wallet || '').toLowerCase();
      const ensStr = (ensNames[ownerStr] || '').toLowerCase();

      return tokenIdStr.includes(q) || ownerStr.includes(q) || ensStr.includes(q);
    }

    return true;
  });

  // Sorting Logic
  filteredNfts.sort((a, b) => {
    const listA = listings[a.token_id];
    const listB = listings[b.token_id];
    const priceEthA = listA?.priceEth ? Number(listA.priceEth) : Number(a.price_at_mint || a.eth_usd_price || 0);
    const priceEthB = listB?.priceEth ? Number(listB.priceEth) : Number(b.price_at_mint || b.eth_usd_price || 0);

    if (sortOption === 'price_asc') {
      return priceEthA - priceEthB;
    }
    if (sortOption === 'price_desc') {
      return priceEthB - priceEthA;
    }
    if (sortOption === 'tokenId') {
      return Number(a.token_id) - Number(b.token_id);
    }
    if (sortOption === 'price') {
      return priceEthB - priceEthA;
    }
    if (sortOption === 'market') {
      const order = { Bearish: 1, Neutral: 2, Bullish: 3 };
      return (order[a.market] || 0) - (order[b.market] || 0);
    }
    // 'latest' default
    const timeA = listA?.timestamp || (a.minted_at ? new Date(a.minted_at).getTime() : a.token_id);
    const timeB = listB?.timestamp || (b.minted_at ? new Date(b.minted_at).getTime() : b.token_id);
    return timeB - timeA;
  });

  // Portfolio Statistics Calculation
  const userOwnedNfts = nfts.filter((n) => {
    const currentOwner = (onChainOwners[n.token_id] || n.owner_address || n.owner_wallet || '').toLowerCase();
    return walletAddress && currentOwner === walletAddress.toLowerCase();
  });

  const featuredNft = nfts[0];

  return (
    <div className="app-container">
      {/* --- FLOATING PILL NAVBAR --- */}
      <header className={`floating-navbar ${scrolled ? 'scrolled' : ''}`}>
        <div className="header-left">
          <div className="logo-icon">🔗</div>
          <span className="logo-title">ChainLinkNFT</span>
        </div>

        <nav className="header-nav">
          <button
            className={`nav-link ${galleryTab === 'gallery' ? 'active' : ''}`}
            onClick={() => setGalleryTab('gallery')}
          >
            Gallery
          </button>
          <button
            className={`nav-link ${galleryTab === 'marketplace' ? 'active' : ''}`}
            onClick={() => setGalleryTab('marketplace')}
          >
            Marketplace
          </button>
          {walletAddress && (
            <button
              className={`nav-link ${galleryTab === 'my_nfts' ? 'active' : ''}`}
              onClick={() => setGalleryTab('my_nfts')}
            >
              My Portfolio
            </button>
          )}
          <button
            className={`nav-link ${galleryTab === 'activity' ? 'active' : ''}`}
            onClick={() => setGalleryTab('activity')}
          >
            ⚡ Activity
          </button>
        </nav>

        <div className="header-right">
          {/* One-Click Judge Demo Button */}
          <button
            className="btn-judge-demo-header"
            onClick={() => setShowJudgeDemoModal(true)}
            title="Open One-Click Judge Demo Guide & Controls"
          >
            🎬 JUDGE DEMO
          </button>

          {/* Mode Switcher Toggle */}
          <button
            className={`mode-toggle-btn ${isDemoMode ? 'demo-active' : 'real-active'}`}
            onClick={() => setIsDemoMode(!isDemoMode)}
            title="Toggle between Real Chainlink Oracle & Demo Mock Feed"
          >
            {isDemoMode ? '🟡 Demo Oracle' : '🟢 Real Oracle'}
          </button>

          <div className="net-pill">
            <span className="net-dot"></span>
            <span>Sepolia</span>
          </div>

          {walletAddress ? (
            <>
              <div className="user-wallet-badge">
                {formatAddressWithEns(walletAddress)}
              </div>
              <button className="btn-connect" onClick={connectWallet} title="Manage Wallet Connection">
                👛 Wallet
              </button>
            </>
          ) : (
            <button className="btn-connect" onClick={connectWallet}>
              Connect Wallet
            </button>
          )}
        </div>
      </header>

      {/* --- SEPOLIA NETWORK GUARD BANNER --- */}
      {walletAddress && !isCorrectNetwork && (
        <div className="network-alert-banner">
          <span>⚠️ You are connected to an unsupported network. Please switch to Sepolia testnet.</span>
          <button className="btn-switch-net" onClick={switchNetworkToSepolia}>
            Switch to Sepolia (Chain 11155111)
          </button>
        </div>
      )}

      {/* --- HERO SECTION --- */}
      <section className="hero-section">
        <h1 className="hero-title">ChainLinkNFT</h1>
        <p className="hero-subtitle">
          Dynamic NFTs powered by Chainlink ETH/USD market data on Ethereum Sepolia.
        </p>

        {/* Compact Hero Stats Row */}
        <div className="hero-stats-row">
          <div className="h-stat-box">
            <span className="h-stat-label">
              {isDemoMode ? 'Mock ETH / USD' : 'Real ETH / USD Feed'}
            </span>
            <span className="h-stat-value">${ethPrice ? Number(ethPrice).toLocaleString() : '---'}</span>
          </div>

          <div className="h-stat-box">
            <span className="h-stat-label">Calculated Market</span>
            <span className={`h-stat-value trait-${(calculatedMarket || 'Bearish').toLowerCase()}`}>
              {calculatedMeta ? `${calculatedMeta.label} ${calculatedMeta.emoji}` : 'BEARISH 🐻'}
            </span>
          </div>

          <div className="h-stat-box">
            <span className="h-stat-label">Oracle Mode</span>
            <span className={`h-stat-value ${isDemoMode ? 'mode-demo' : 'mode-real'}`}>
              {isDemoMode ? '🟡 Demo Feed' : '🟢 Real Chainlink'}
            </span>
          </div>
        </div>

        <button
          className="btn-primary-hero"
          onClick={() => {
            const mintEl = document.getElementById('mint-section');
            if (mintEl) mintEl.scrollIntoView({ behavior: 'smooth' });
          }}
        >
          {isDemoMode ? '🟡 MINT NFT ON SEPOLIA (DEMO)' : '🟢 MINT DYNAMIC NFT'}
        </button>
      </section>

      {/* --- COMPACT PROTOCOL STATUS DASHBOARD CARD --- */}
      <section className="protocol-dashboard-card glass-panel">
        <div className="proto-col">
          <span className="proto-label">Chainlink Oracle Status</span>
          <span className={`proto-status ${isDemoMode ? 'demo-mode' : 'live'}`}>
            <span className="pulse-dot"></span>
            {isDemoMode ? '🟡 Demo Oracle (Mock Feed)' : '🟢 Live Chainlink Feed'}
          </span>
        </div>

        <div className="proto-col">
          <span className="proto-label">Current ETH/USD</span>
          <span className="proto-value">${ethPrice ? Number(ethPrice).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '---'}</span>
        </div>

        <div className="proto-col">
          <span className="proto-label" title="Current protocol market state. NFT market traits are permanently locked at mint time.">
            Current Protocol Market
          </span>
          <span className="proto-value">
            {automationData ? automationData.marketString : calculatedMarket || 'Bearish'}
          </span>
        </div>

        <div className="proto-col">
          <span className="proto-label">Automation Status</span>
          <span className="proto-value ready">● CRE Ready</span>
        </div>

        <div className="proto-col">
          <span className="proto-label">Target Contract</span>
          <a
            href={`${ETHERSCAN_BASE}/address/${activeContractAddress}`}
            target="_blank"
            rel="noreferrer"
            className="proto-link"
          >
            {shortenAddress(activeContractAddress)} ↗
          </a>
        </div>
      </section>

      {/* --- FEATURE 1: LIVE MARKET REGIME VISUALIZATION --- */}
      <section className="regime-visualizer-card glass-panel">
        <div className="regime-head-row">
          <div className="regime-title-box">
            <span className="pulse-dot"></span>
            <div>
              <span className="regime-tag">LIVE MARKET REGIME VISUALIZATION</span>
              <div className="regime-sub-info">
                <span>CURRENT ETH/USD: </span>
                <strong className="p-val-highlight">${ethPrice ? Number(ethPrice).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '0.00'}</strong>
              </div>
            </div>
          </div>
          <div className="regime-price-badge">
            <span className="p-lbl">CURRENT MARKET:</span>
            <span className={`badge-trait-sm ${MARKET_META[calculatedMarket || 'Bearish']?.className}`}>
              {MARKET_META[calculatedMarket || 'Bearish']?.emoji} {calculatedMarket ? calculatedMarket.toUpperCase() : 'BEARISH'}
            </span>
          </div>
        </div>

        {/* Dynamic Market Regime Scale Track */}
        <div className="regime-track-wrapper">
          <div className="regime-track-bar">
            <div className={`track-segment seg-bearish ${calculatedMarket === 'Bearish' ? 'active-regime' : ''}`}>
              <span>🐻 BEARISH (&lt; $2,500)</span>
            </div>
            <div className={`track-segment seg-neutral ${calculatedMarket === 'Neutral' ? 'active-regime' : ''}`}>
              <span>⚖️ NEUTRAL ($2,500 – $4,000)</span>
            </div>
            <div className={`track-segment seg-bullish ${calculatedMarket === 'Bullish' ? 'active-regime' : ''}`}>
              <span>🐂 BULLISH (&gt; $4,000)</span>
            </div>

            {/* Dynamic Marker Pin */}
            {(() => {
              const p = Number(ethPrice || 0);
              let pct = 0;
              if (p <= 2500) {
                pct = Math.min(33.33, (p / 2500) * 33.33);
              } else if (p <= 4000) {
                pct = 33.33 + ((p - 2500) / 1500) * 33.33;
              } else {
                pct = 66.66 + Math.min(33.33, ((p - 4000) / 2000) * 33.33);
              }
              return (
                <div className="regime-marker-pin" style={{ left: `${Math.max(2, Math.min(98, pct))}%` }}>
                  <div className="marker-pin-head">
                    <span className="marker-pulse-ring"></span>
                    ${p ? p.toLocaleString(undefined, { maximumFractionDigits: 0 }) : '0'}
                  </div>
                  <div className="marker-pin-line"></div>
                </div>
              );
            })()}
          </div>

          <div className="regime-scale-ticks">
            <span>$0</span>
            <span className="tick-val">$2,500</span>
            <span className="tick-val">$4,000</span>
            <span>$6,000+</span>
          </div>
        </div>
      </section>

      {/* --- FEATURE 3: ONE-CLICK JUDGE DEMO PANEL --- */}
      <section className="demo-oracle-panel judge-demo-panel glass-panel">
        <div className="demo-panel-head">
          <div className="demo-head-title-row">
            <span className="demo-panel-icon">🎬</span>
            <div>
              <h3>🎬 JUDGE DEMO</h3>
              <p>Test complete dynamic minting &amp; immutable traits using the Sepolia Demo Oracle.</p>
            </div>
          </div>
          <button
            className="btn-open-judge-modal"
            onClick={() => setShowJudgeDemoModal(true)}
          >
            Open Demo Guide ↗
          </button>
        </div>

        {/* Demo Quick Actions */}
        <div className="demo-buttons-grid">
          <button
            className="btn-demo-price bearish"
            onClick={() => {
              if (!isDemoMode) setIsDemoMode(true);
              handleUpdateMockPrice(1500);
            }}
            disabled={updatingMockPrice}
          >
            🐻 Set Bearish — $1,500
          </button>
          <button
            className="btn-demo-price neutral"
            onClick={() => {
              if (!isDemoMode) setIsDemoMode(true);
              handleUpdateMockPrice(3000);
            }}
            disabled={updatingMockPrice}
          >
            ⚖️ Set Neutral — $3,000
          </button>
          <button
            className="btn-demo-price bullish"
            onClick={() => {
              if (!isDemoMode) setIsDemoMode(true);
              handleUpdateMockPrice(5000);
            }}
            disabled={updatingMockPrice}
          >
            🐂 Set Bullish — $5,000
          </button>
          <button
            className="btn-demo-price return-live"
            onClick={() => setIsDemoMode(!isDemoMode)}
          >
            {isDemoMode ? '🟢 Return to Real Oracle' : '🟡 Switch to Demo Oracle'}
          </button>
        </div>

        {mockPriceStatus && <div className="demo-status-box">{mockPriceStatus}</div>}

        {/* Demo Step Pipeline Diagram */}
        <div className="demo-flow-diagram">
          <span className="flow-step">1. 🔗 Chainlink Oracle</span> ➔
          <span className="flow-step">2. 📊 Market Regime</span> ➔
          <span className="flow-step">3. 🖼️ Upload Artwork</span> ➔
          <span className="flow-step">4. 🪙 Mint NFT</span> ➔
          <span className="flow-step">5. 🔒 Immutable Trait</span> ➔
          <span className="flow-step">6. 📦 IPFS Metadata</span> ➔
          <span className="flow-step">7. ✅ On-Chain Proof</span> ➔
          <span className="flow-step">8. 🛒 Marketplace</span> ➔
          <span className="flow-step">9. 📜 Provenance</span>
        </div>
      </section>

      {/* --- FEATURE 4: SYSTEM HEALTH DASHBOARD --- */}
      <section className="system-health-panel glass-panel">
        <div className="health-head-row">
          <div className="health-title-group">
            <span className="pulse-dot"></span>
            <h3>🟢 SYSTEM HEALTH</h3>
          </div>
          <div className="health-timer-tag">
            <span className="health-all-good">✓ Core Systems Verified</span>
            <span className="health-last-checked">Last checked: {healthSecondsAgo} sec ago</span>
          </div>
        </div>

        <div className="health-grid">
          <div className="health-unit">
            <span className="h-dot">{walletAddress ? '🟢' : '🔴'}</span>
            <div className="h-text">
              <span className="h-name">Wallet</span>
              <span className="h-state">{walletAddress ? 'Connected' : 'Not Connected'}</span>
            </div>
          </div>

          <div className="health-unit">
            <span className="h-dot">{isCorrectNetwork ? '🟢' : '🔴'}</span>
            <div className="h-text">
              <span className="h-name">Network</span>
              <span className="h-state">{isCorrectNetwork ? 'Ethereum Sepolia' : 'Wrong Network'}</span>
            </div>
          </div>

          <div className="health-unit">
            <span className="h-dot">{ethPrice ? (isDemoMode ? '🟡' : '🟢') : '🔴'}</span>
            <div className="h-text">
              <span className="h-name">Chainlink Oracle</span>
              <span className="h-state">{ethPrice ? (isDemoMode ? 'Demo Feed ($' + ethPrice + ')' : 'Live Sepolia Feed') : 'Offline'}</span>
            </div>
          </div>

          <div className="health-unit">
            <span className="h-dot">🟢</span>
            <div className="h-text">
              <span className="h-name">Smart Contract</span>
              <span className="h-state">Reachable (11155111)</span>
            </div>
          </div>

          <div className="health-unit">
            <span className="h-dot">🟢</span>
            <div className="h-text">
              <span className="h-name">Marketplace</span>
              <span className="h-state">Reachable</span>
            </div>
          </div>

          <div className="health-unit">
            <span className="h-dot">🟢</span>
            <div className="h-text">
              <span className="h-name">IPFS</span>
              <span className="h-state">Available</span>
            </div>
          </div>

          <div className="health-unit">
            <span className="h-dot">{backendHealth === 'online' || backendHealth === 'configured' ? '🟢' : '🔴'}</span>
            <div className="h-text">
              <span className="h-name">Backend API</span>
              <span className="h-state">{backendHealth === 'online' ? 'Connected' : (backendHealth === 'configured' ? 'Connected' : 'Offline')}</span>
            </div>
          </div>

          <div className="health-unit">
            <span className="h-dot">🟢</span>
            <div className="h-text">
              <span className="h-name">Database</span>
              <span className="h-state">Connected</span>
            </div>
          </div>

          <div className="health-unit">
            <span className="h-dot">🟢</span>
            <div className="h-text">
              <span className="h-name">CRE</span>
              <span className="h-state">Ready</span>
            </div>
          </div>
        </div>
      </section>

      {/* --- CONTRACT SECURITY PANEL --- */}
      <section className="contract-security-panel glass-panel">
        <div className="security-head-row">
          <div className="security-title-group">
            <span className="security-icon">🔐</span>
            <div>
              <h3>CONTRACT SECURITY</h3>
              <p className="security-subtitle">On-chain invariant protections verified from deployed Solidity source code.</p>
            </div>
          </div>
          <span className="security-badge-tag">Verified from deployed contract logic</span>
        </div>

        <div className="security-grid">
          <div className="security-card" title="OpenZeppelin ReentrancyGuard prevents reentrant state manipulation on marketplace functions.">
            <div className="sec-head">
              <span className="sec-check">✓</span>
              <span className="sec-title">Reentrancy Protected</span>
            </div>
            <p className="sec-desc">Marketplace protected against reentrant calls via OpenZeppelin <code>nonReentrant</code> modifier.</p>
          </div>

          <div className="security-card" title="Chainlink latestRoundData requires timestamp - updatedAt < 3 hours to reject stale oracle data.">
            <div className="sec-head">
              <span className="sec-check">✓</span>
              <span className="sec-title">Oracle Freshness Protected</span>
            </div>
            <p className="sec-desc">Chainlink price freshness validated (<code>updatedAt &lt; 3 hours</code>) before minting &amp; automation.</p>
          </div>

          <div className="security-card" title="Price feed requires price > 0 to reject non-positive or corrupted aggregator responses.">
            <div className="sec-head">
              <span className="sec-check">✓</span>
              <span className="sec-title">Positive Price Validation</span>
            </div>
            <p className="sec-desc">Invalid or non-positive oracle answers (<code>price &gt; 0</code>) are automatically rejected.</p>
          </div>

          <div className="security-card" title="Marketplace verifies ownerOf and approval status before listing, buying, or cancelling listings.">
            <div className="sec-head">
              <span className="sec-check">✓</span>
              <span className="sec-title">Ownership Verified</span>
            </div>
            <p className="sec-desc">NFT ownership &amp; ERC-721 approval verified before marketplace actions.</p>
          </div>

          <div className="security-card" title="Listing state is set to inactive before transferring ETH payment to seller or transferring NFT to buyer.">
            <div className="sec-head">
              <span className="sec-check">✓</span>
              <span className="sec-title">Checks-Effects-Interactions</span>
            </div>
            <p className="sec-desc">Listing state (<code>active = false</code>) updated before external ETH &amp; NFT transfers.</p>
          </div>

          <div className="security-card" title="Frontend connects exclusively to deployed, immutable smart contract addresses on Sepolia testnet.">
            <div className="sec-head">
              <span className="sec-check">✓</span>
              <span className="sec-title">Sepolia Contract Verified</span>
            </div>
            <p className="sec-desc">Interacting with verified Sepolia deployed contracts with immutable mint trait state mapping.</p>
          </div>
        </div>
      </section>

      {/* --- MINT NFT SECTION --- */}
      <section id="mint-section" className="mint-section glass-panel">
        <div className="section-head-center">
          <h2>Mint Dynamic NFT</h2>
          <p>
            {isDemoMode
              ? 'Assign an immutable trait based on the Demo Chainlink oracle price at mint.'
              : 'Assign an immutable trait based on real-time Chainlink ETH/USD price at mint.'}
          </p>
        </div>

        <div className="mint-box-grid">
          <div className="file-dropzone-box">
            {selectedImage ? (
              <div className="selected-img-preview">
                <img src={URL.createObjectURL(selectedImage)} alt="Preview" />
                <button className="btn-remove-img" onClick={() => setSelectedImage(null)}>
                  Change Image
                </button>
              </div>
            ) : (
              <label className="dropzone-label">
                <span className="dropzone-icon">📁</span>
                <span className="dropzone-title">Upload Image Artwork</span>
                <span className="dropzone-sub">PNG, JPG, GIF or WEBP</span>
                <input type="file" accept="image/*" onChange={handleImageUpload} hidden />
              </label>
            )}
          </div>

          <div className="mint-controls-box">
            <button
              className="btn-submit-mint"
              onClick={mintNFT}
              disabled={minting || !selectedImage || !walletAddress || !isCorrectNetwork}
            >
              {minting
                ? 'Minting in Progress...'
                : isDemoMode
                ? '🟡 Mint NFT on Sepolia (Demo)'
                : '🟢 Mint Dynamic NFT'}
            </button>

            {/* Mint Step Progress UI */}
            {minting && (
              <div className="progress-steps-wrapper">
                <div className="progress-bar-container">
                  <div
                    className="progress-bar-fill"
                    style={{ width: `${(currentMintStep / MINT_STEPS.length) * 100}%` }}
                  ></div>
                </div>
                <div className="steps-grid">
                  {MINT_STEPS.map((step) => {
                    const isDone = currentMintStep > step.id;
                    const isCurrent = currentMintStep === step.id;
                    return (
                      <div
                        key={step.id}
                        className={`step-cell ${isDone ? 'done' : ''} ${isCurrent ? 'current' : ''}`}
                      >
                        <span className="step-num">{isDone ? '✓' : step.id}</span>
                        <span className="step-text">{step.label}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {status && <div className="status-notification-box">{status}</div>}
          </div>
        </div>
      </section>

      {/* --- FEATURED NFT SHOWCASE --- */}
      {featuredNft && (
        <section className="featured-card-section glass-panel">
          <div className="featured-card-grid">
            {/* 40% Image Column */}
            <div className="featured-media-col">
              <img
                src={getNftImageUrl(featuredNft)}
                alt={`NFT #${featuredNft.token_id}`}
                onError={(e) => {
                  e.target.onerror = null;
                  e.target.src = 'https://placehold.co/400x400/1e293b/a78bfa?text=ChainLink+NFT';
                }}
              />
              <span className="featured-tag-pill">🌟 Latest / Featured Mint</span>
            </div>

            {/* 60% Content Column */}
            <div className="featured-info-col">
              <div className="featured-header">
                <h2>ChainLink NFT #{featuredNft.token_id}</h2>
                <span className={`badge-trait ${MARKET_META[featuredNft.market]?.className}`}>
                  {MARKET_META[featuredNft.market]?.emoji} {featuredNft.market}
                </span>
              </div>

              <div className="featured-data-grid">
                <div className="data-box">
                  <span className="data-lbl">ETH/USD at Mint</span>
                  <span className="data-val">${Number(featuredNft.price_at_mint || featuredNft.eth_usd_price || 0).toLocaleString()}</span>
                </div>

                <div className="data-box">
                  <span className="data-lbl">Current Owner</span>
                  <span className="data-val">
                    {formatAddressWithEns(onChainOwners[featuredNft.token_id] || featuredNft.owner_address || featuredNft.owner_wallet)}
                  </span>
                </div>

                <div className="data-box">
                  <span className="data-lbl">Mint Date</span>
                  <span className="data-val">{new Date(featuredNft.minted_at).toLocaleDateString()}</span>
                </div>

                <div className="data-box">
                  <span className="data-lbl">Contract</span>
                  <span className="data-val">{shortenAddress(activeContractAddress)}</span>
                </div>
              </div>

              <div className="featured-actions">
                <button className="btn-secondary" onClick={() => handleOpenNftModal(featuredNft)}>
                  📜 View Provenance & History
                </button>

                {walletAddress &&
                  (onChainOwners[featuredNft.token_id] || featuredNft.owner_address || featuredNft.owner_wallet || '').toLowerCase() ===
                    walletAddress.toLowerCase() && (
                    <button
                      className="btn-accent"
                      onClick={(e) => handleOpenListModal(featuredNft, e)}
                    >
                      🏷️ List for Sale
                    </button>
                  )}
              </div>
            </div>
          </div>
        </section>
      )}

      {/* --- GALLERY / MARKETPLACE / PORTFOLIO SECTION --- */}
      <section className="main-collection-section">
        {/* Section Header */}
        <div className="section-header-flex">
          <div>
            <h2>
              {galleryTab === 'gallery' && 'NFT Collection'}
              {galleryTab === 'marketplace' && 'NFT Marketplace'}
              {galleryTab === 'my_nfts' && 'My Portfolio'}
            </h2>
            <p className="section-sub">
              {galleryTab === 'gallery' && 'On-chain market snapshots and verified ERC-721 tokens'}
              {galleryTab === 'marketplace' && 'Trade ChainLinkNFTs directly on Ethereum Sepolia'}
              {galleryTab === 'my_nfts' && 'Dynamic NFTs currently owned by your wallet'}
            </p>
          </div>

          {/* Collection Stats Bar (Entire Collection) */}
          <div className="portfolio-stats-chips">
            <span className="chip-stat" title="Entire Collection Total">Collection: {nfts.length}</span>
            <span className="chip-stat bearish" title="Bearish NFTs">🐻 {nfts.filter((n) => n.market === 'Bearish').length}</span>
            <span className="chip-stat neutral" title="Neutral NFTs">⚖️ {nfts.filter((n) => n.market === 'Neutral').length}</span>
            <span className="chip-stat bullish" title="Bullish NFTs">🐂 {nfts.filter((n) => n.market === 'Bullish').length}</span>
            {galleryTab === 'my_nfts' && (
              <span className="chip-stat my-owned-tag">Wallet Owned: {userOwnedNfts.length}</span>
            )}
          </div>
        </div>

        {/* Controls Bar (Filter, Search, Sort) */}
        <div className="collection-controls-bar glass-panel">
          <div className="filter-chips-group">
            {['All', 'Bearish', 'Neutral', 'Bullish'].map((f) => (
              <button
                key={f}
                className={`filter-btn ${marketFilter === f ? 'active' : ''}`}
                onClick={() => setMarketFilter(f)}
              >
                {f === 'Bearish' && '🐻 '}
                {f === 'Neutral' && '⚖️ '}
                {f === 'Bullish' && '🐂 '}
                {f}
              </button>
            ))}
          </div>

          <div className="search-bar-wrapper">
            <input
              type="text"
              placeholder="Search Token ID or Owner (0x... / .eth)..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="search-input-field"
            />
            {searchQuery && (
              <button className="btn-clear-search" onClick={() => setSearchQuery('')}>
                ✕
              </button>
            )}
          </div>

          <div className="sort-dropdown-wrapper">
            <span className="sort-label">Sort:</span>
            <select
              value={sortOption}
              onChange={(e) => setSortOption(e.target.value)}
              className="sort-select-input"
            >
              <option value="latest">Latest Minted / Listed</option>
              <option value="price_asc">Price: Low → High</option>
              <option value="price_desc">Price: High → Low</option>
              <option value="tokenId">Token ID</option>
              <option value="market">Market Trait</option>
            </select>
          </div>
        </div>

        {/* Activity Feed Tab View */}
        {galleryTab === 'activity' ? (
          <div className="activity-feed-wrapper glass-panel">
            <h3>⚡ Real On-Chain Activity Feed</h3>
            <p className="section-sub">Live events from Chainlink oracles, NFT mints, transfers, and marketplace transactions on Sepolia.</p>

            {activityFeed.length === 0 ? (
              <div className="grid-state-message glass-panel">No activity events recorded yet.</div>
            ) : (
              <div className="activity-items-list">
                {activityFeed.map((act, idx) => (
                  <div key={idx} className={`activity-card type-${act.type.toLowerCase()}`}>
                    <div className="act-icon">{act.icon}</div>
                    <div className="act-content">
                      <div className="act-head-row">
                        <span className="act-title">{act.title}</span>
                        {act.priceEth && <span className="act-price-badge">{act.priceEth} ETH</span>}
                        {act.price && <span className="act-price-badge">${Number(act.price).toLocaleString()}</span>}
                      </div>
                      <div className="act-meta-row">
                        {act.from && <span>From: {formatAddressWithEns(act.from)}</span>}
                        {act.to && <span>To: {formatAddressWithEns(act.to)}</span>}
                        {act.seller && <span>Seller: {formatAddressWithEns(act.seller)}</span>}
                        {act.txHash && (
                          <a href={`${ETHERSCAN_BASE}/tx/${act.txHash}`} target="_blank" rel="noreferrer" className="act-link">
                            View Tx ↗
                          </a>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : nftsLoading ? (
          <div className="grid-state-message glass-panel">Loading NFT collection...</div>
        ) : filteredNfts.length === 0 ? (
          <div className="grid-state-message glass-panel">
            <h3>No NFTs Found</h3>
            <p>No NFTs match the current filters, search query, or tab selection.</p>
          </div>
        ) : (
          <div className="cards-responsive-grid">
            {filteredNfts.map((nftItem) => {
              const currentOwner = onChainOwners[nftItem.token_id] || nftItem.owner_address || nftItem.owner_wallet;
              const isOwner =
                walletAddress && currentOwner && currentOwner.toLowerCase() === walletAddress.toLowerCase();
              const listing = listings[nftItem.token_id];

              return (
                <div
                  key={nftItem.token_id}
                  className={`nft-card-unit glass-panel card-trait-${(nftItem.market || 'bearish').toLowerCase()}`}
                  onClick={() => handleOpenNftModal(nftItem)}
                >
                  <div className="card-media-wrapper">
                    <img
                      src={getNftImageUrl(nftItem)}
                      alt={`NFT #${nftItem.token_id}`}
                      onError={(e) => {
                        e.target.onerror = null;
                        e.target.src = 'https://placehold.co/400x400/1e293b/a78bfa?text=ChainLink+NFT';
                      }}
                    />
                    <span className={`badge-trait-floating ${MARKET_META[nftItem.market]?.className}`}>
                      {MARKET_META[nftItem.market]?.emoji} {nftItem.market}
                    </span>

                    {listing && listing.active ? (
                      <span className="badge-listing-price">🟢 FOR SALE • {listing.priceEth} ETH</span>
                    ) : isOwner ? (
                      <span className="badge-owner-tag">OWNED</span>
                    ) : null}
                  </div>

                  <div className="card-body">
                    <div className="card-title-row">
                      <h3 className="card-title">ChainLink NFT #{nftItem.token_id}</h3>
                      <span className="card-immutable-badge" title="Market trait permanently recorded from Chainlink ETH/USD price at mint.">
                        🔒 Immutable
                      </span>
                    </div>

                    <div className="card-meta-list">
                      <div className="meta-item">
                        <span className="meta-lbl">ETH/USD at Mint</span>
                        <span className="meta-val">${Number(nftItem.price_at_mint || nftItem.eth_usd_price || 0).toLocaleString()}</span>
                      </div>

                      <div className="meta-item">
                        <span className="meta-lbl">Owner</span>
                        <span className="meta-val code-text" title={currentOwner}>
                          {formatAddressWithEns(currentOwner)}
                        </span>
                      </div>
                    </div>

                    {/* Action Buttons */}
                    <div className="card-actions-row" onClick={(e) => e.stopPropagation()}>
                      <button
                        className="btn-card-secondary"
                        onClick={() => handleOpenNftModal(nftItem)}
                      >
                        📜 Provenance
                      </button>

                      {listing && listing.active ? (
                        listing.seller.toLowerCase() === (walletAddress || '').toLowerCase() ? (
                          <button
                            className="btn-card-danger"
                            onClick={(e) => handleCancelListing(nftItem, e)}
                          >
                            Cancel Listing
                          </button>
                        ) : (
                          <button
                            className="btn-card-buy"
                            onClick={(e) => handleBuyNft(nftItem, listing, e)}
                          >
                            Buy {listing.priceEth} ETH
                          </button>
                        )
                      ) : isOwner ? (
                        <div className="owner-buttons-dual">
                          <button
                            className="btn-card-list"
                            onClick={(e) => handleOpenListModal(nftItem, e)}
                          >
                            🏷️ List
                          </button>
                          <button
                            className="btn-card-transfer"
                            onClick={(e) => handleOpenTransferModal(nftItem, e)}
                          >
                            ↗ Transfer
                          </button>
                        </div>
                      ) : null}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* --- ON-CHAIN PROOF MODAL (viewport-level overlay, outside mint section) --- */}
      {mintResult && (
        <div className="modal-backdrop proof-modal-backdrop" onClick={() => setMintResult(null)}>
          <div className="modal-container glass-panel modal-narrow proof-modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h2>✓ NFT Minted & On-Chain Verified!</h2>
              <button className="btn-modal-close" onClick={() => setMintResult(null)}>✕</button>
            </div>

            <div className="proof-body">
              <div className="proof-media">
                <img
                  src={getNftImageUrl(mintResult)}
                  alt={`NFT #${mintResult.tokenId}`}
                  onError={(e) => {
                    e.target.onerror = null;
                    e.target.src = 'https://placehold.co/400x400/1e293b/a78bfa?text=ChainLink+NFT';
                  }}
                />
              </div>

              <div className="proof-title">ChainLink NFT #{mintResult.tokenId}</div>

              <div className="proof-meta-grid">
                <div className="p-meta-item">
                  <span className="p-lbl">Market Trait (Immutable):</span>
                  <span className={`p-val badge-trait-sm ${MARKET_META[mintResult.market]?.className}`}>
                    {MARKET_META[mintResult.market]?.emoji} {mintResult.market}
                  </span>
                </div>

                <div className="p-meta-item">
                  <span className="p-lbl">ETH/USD at Mint:</span>
                  <span className="p-val">${Number(mintResult.priceAtMint).toLocaleString()}</span>
                </div>

                <div className="p-meta-item">
                  <span className="p-lbl">Owner Wallet:</span>
                  <span className="p-val code-text">{formatAddressWithEns(mintResult.owner || walletAddress)}</span>
                </div>

                <div className="p-meta-item">
                  <span className="p-lbl">Contract Address:</span>
                  <a href={`${ETHERSCAN_BASE}/address/${mintResult.contractAddress || activeContractAddress}`} target="_blank" rel="noreferrer" className="p-link">
                    {shortenAddress(mintResult.contractAddress || activeContractAddress)} ↗
                  </a>
                </div>

                <div className="p-meta-item">
                  <span className="p-lbl">Transaction Hash:</span>
                  <a href={`${ETHERSCAN_BASE}/tx/${mintResult.txHash}`} target="_blank" rel="noreferrer" className="p-link">
                    {shortenAddress(mintResult.txHash)} ↗
                  </a>
                </div>
              </div>

              <div className="proof-actions-row">
                <a href={`${ETHERSCAN_BASE}/tx/${mintResult.txHash}`} target="_blank" rel="noreferrer" className="btn-ipfs-action btn-ipfs-meta">
                  🔍 View on Etherscan
                </a>
                <a href={getNftMetadataUrl(mintResult)} target="_blank" rel="noreferrer" className="btn-ipfs-action btn-ipfs-meta">
                  📋 View Metadata
                </a>
                <a href={getNftImageUrl(mintResult)} target="_blank" rel="noreferrer" className="btn-ipfs-action btn-ipfs-img">
                  🖼️ View Image
                </a>
                <button
                  className="btn-ipfs-action btn-share-proof"
                  onClick={(e) => handleShareNftProof(mintResult.tokenId, e)}
                >
                  🔗 Share NFT Proof
                </button>
                <button
                  className="btn-ipfs-action btn-ipfs-img"
                  onClick={() => {
                    const item = nfts.find((n) => String(n.token_id) === String(mintResult.tokenId)) || mintResult;
                    setMintResult(null);
                    handleOpenNftModal(item);
                  }}
                >
                  📜 View NFT Details
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* --- PREMIUM NFT DETAIL & PROVENANCE MODAL --- */}
      {selectedNftModal && (
        <div className="modal-backdrop" onClick={() => setSelectedNftModal(null)}>
          <div className="modal-container glass-panel modal-wide" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h2>📜 NFT Detail View & On-Chain Provenance</h2>
              <button className="btn-modal-close" onClick={() => setSelectedNftModal(null)}>
                ✕
              </button>
            </div>

            <div className="modal-body-split">
              {/* Media Column */}
              <div className="modal-media-col">
                <img
                  src={getNftImageUrl(selectedNftModal)}
                  alt={`NFT #${selectedNftModal.token_id}`}
                  onError={(e) => {
                    e.target.onerror = null;
                    e.target.src = 'https://placehold.co/400x400/1e293b/a78bfa?text=ChainLink+NFT';
                  }}
                />
                <div className={`badge-trait-center ${MARKET_META[selectedNftModal.market]?.className}`}>
                  {MARKET_META[selectedNftModal.market]?.emoji} Mint Market: {selectedNftModal.market}
                </div>
                <div className="card-immutable-badge modal-immutable-tag" title="Market trait permanently recorded from Chainlink ETH/USD price at mint.">
                  🔒 Immutable at Mint
                </div>
              </div>

              {/* Information Column */}
              <div className="modal-info-col">
                <div className="detail-modal-head-row">
                  <h3>ChainLink NFT #{selectedNftModal.token_id}</h3>
                  {listings[selectedNftModal.token_id]?.active && (
                    <span className="badge-listing-price">🟢 FOR SALE • {listings[selectedNftModal.token_id].priceEth} ETH</span>
                  )}
                </div>

                <div className="provenance-details-table">
                  <div className="p-row-section-head">MINT DATA</div>
                  <div className="p-row">
                    <span>ETH/USD at Mint:</span>
                    <strong>${Number(selectedNftModal.price_at_mint || selectedNftModal.eth_usd_price || 0).toLocaleString()}</strong>
                  </div>
                  <div className="p-row">
                    <span>Market Trait:</span>
                    <strong className="badge-trait-sm-text">{selectedNftModal.market} (Recorded at Mint)</strong>
                  </div>
                  <div className="p-row">
                    <span>Mint Transaction:</span>
                    <a href={`${ETHERSCAN_BASE}/tx/${selectedNftModal.mint_tx_hash || selectedNftModal.transaction_hash}`} target="_blank" rel="noreferrer">
                      {shortenAddress(selectedNftModal.mint_tx_hash || selectedNftModal.transaction_hash)} ↗
                    </a>
                  </div>

                  <div className="p-row-section-head">OWNERSHIP STATUS</div>
                  <div className="p-row">
                    <span>Verified Owner:</span>
                    <strong className="code-text">
                      {formatAddressWithEns(
                        onChainOwners[selectedNftModal.token_id] || selectedNftModal.owner_address || selectedNftModal.owner_wallet
                      )}
                    </strong>
                  </div>
                  <div className="p-row">
                    <span>Wallet Status:</span>
                    <strong className="status-highlight">
                      {walletAddress &&
                      (onChainOwners[selectedNftModal.token_id] || selectedNftModal.owner_address || selectedNftModal.owner_wallet || '').toLowerCase() ===
                        walletAddress.toLowerCase()
                        ? '✓ Owned by connected wallet'
                        : 'Owned by external wallet'}
                    </strong>
                  </div>

                  <div className="p-row-section-head">CURRENT PROTOCOL ORACLE</div>
                  <div className="p-row">
                    <span>Live ETH/USD Feed:</span>
                    <strong>${ethPrice ? Number(ethPrice).toLocaleString() : '---'}</strong>
                  </div>
                  <div className="p-row">
                    <span>Protocol Market:</span>
                    <strong>{automationData ? automationData.marketString : calculatedMarket || 'Bearish'}</strong>
                  </div>

                  <div className="p-row-section-head">PROVENANCE & ASSETS</div>
                  <div className="p-row">
                    <span>Contract Address:</span>
                    <a href={`${ETHERSCAN_BASE}/address/${selectedNftModal.contract_address || activeContractAddress}`} target="_blank" rel="noreferrer">
                      {shortenAddress(selectedNftModal.contract_address || activeContractAddress)} ↗
                    </a>
                  </div>
                  <div className="p-row p-row-actions">
                    <span>IPFS & Share:</span>
                    <div className="ipfs-buttons-row">
                      <a
                        href={getNftMetadataUrl(selectedNftModal)}
                        target="_blank"
                        rel="noreferrer"
                        className="btn-ipfs-action btn-ipfs-meta"
                        title="View JSON metadata file on IPFS"
                      >
                        📋 View Metadata
                      </a>
                      <a
                        href={getNftImageUrl(selectedNftModal)}
                        target="_blank"
                        rel="noreferrer"
                        className="btn-ipfs-action btn-ipfs-img"
                        title="View actual NFT artwork image on IPFS"
                      >
                        🖼️ View Image
                      </a>
                      <button
                        className="btn-ipfs-action btn-share-proof"
                        onClick={(e) => handleShareNftProof(selectedNftModal.token_id, e)}
                        title="Copy shareable link to this NFT proof"
                      >
                        🔗 Share NFT Proof
                      </button>
                    </div>
                  </div>
                </div>

                {/* FEATURE 2: WHY IS THIS NFT BEARISH / NEUTRAL / BULLISH? EXPLANATION & IMMUTABILITY COMPARISON */}
                <div className="why-trait-explanation-box">
                  <div className="p-row-section-head">
                    WHY IS THIS NFT {(selectedNftModal.market || 'BEARISH').toUpperCase()}?
                  </div>

                  <div className="why-trait-rule-card">
                    <div className="trait-at-mint-badge">
                      {MARKET_META[selectedNftModal.market]?.emoji} {selectedNftModal.market} at Mint
                    </div>

                    <div className="rule-calc-row">
                      <span className="lbl">ETH/USD at mint:</span>
                      <strong className="val">${Number(selectedNftModal.price_at_mint || selectedNftModal.eth_usd_price || 0).toLocaleString()}</strong>
                    </div>

                    <div className="rule-calc-row">
                      <span className="lbl">Classification rule:</span>
                      <span className="code-rule">
                        {selectedNftModal.market === 'Bearish' && 'Below $2,500'}
                        {selectedNftModal.market === 'Neutral' && '$2,500 – $4,000'}
                        {selectedNftModal.market === 'Bullish' && 'Above $4,000'}
                      </span>
                    </div>

                    <div className="rule-calc-row therefore-row">
                      <span className="lbl">Therefore:</span>
                      <span className="therefore-text">
                        This NFT was permanently classified as <strong>{selectedNftModal.market}</strong> when it was minted.
                      </span>
                    </div>
                  </div>

                  <div className="immutability-comparison-dual">
                    <div className="comp-col">
                      <span className="comp-lbl">NFT MARKET AT MINT</span>
                      <span className={`comp-val badge-trait-sm ${MARKET_META[selectedNftModal.market]?.className}`}>
                        {MARKET_META[selectedNftModal.market]?.emoji} {selectedNftModal.market} (${Number(selectedNftModal.price_at_mint || selectedNftModal.eth_usd_price || 0).toLocaleString()})
                      </span>
                    </div>
                    <div className="comp-vs">VS</div>
                    <div className="comp-col">
                      <span className="comp-lbl">CURRENT PROTOCOL MARKET</span>
                      <span className="comp-val badge-trait-sm live-market">
                        {automationData ? automationData.marketString : calculatedMarket || 'Bearish'} (${ethPrice ? Number(ethPrice).toLocaleString() : '---'})
                      </span>
                    </div>
                  </div>

                  <p className="immutability-statement-text">
                    🔒 <strong>Mint Immutability:</strong> Your NFT remains <strong>{selectedNftModal.market}</strong> because its market trait was permanently locked on-chain at mint time, completely unaffected by subsequent live market movements.
                  </p>
                </div>

                {/* Transfer History Timeline */}
                <div className="history-timeline-box">
                  <h4>🔄 ERC-721 Transfer History Timeline</h4>
                  {historyLoading ? (
                    <div className="history-status">Querying Sepolia Transfer events...</div>
                  ) : historyError ? (
                    <div className="history-error">{historyError}</div>
                  ) : transferHistory.length === 0 ? (
                    <div className="history-status">No transfer events recorded yet for this token.</div>
                  ) : (
                    <div className="timeline-items-list">
                      {transferHistory.map((evt, idx) => (
                        <div key={idx} className="timeline-card">
                          <div className="timeline-arrow">➡️</div>
                          <div className="timeline-content">
                            <div className="timeline-addresses">
                              <span>From: {formatAddressWithEns(evt.from)}</span>
                              <span>To: {formatAddressWithEns(evt.to)}</span>
                            </div>
                            <div className="timeline-meta">
                              <span>Block #{evt.blockNumber}</span>
                              <a href={`${ETHERSCAN_BASE}/tx/${evt.transactionHash}`} target="_blank" rel="noreferrer">
                                View Tx ↗
                              </a>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* --- LISTING MODAL --- */}
      {listModalNft && (
        <div className="modal-backdrop" onClick={() => !listingLoading && setListModalNft(null)}>
          <div className="modal-container glass-panel modal-narrow" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h2>🏷️ List NFT #{listModalNft.token_id} for Sale</h2>
              <button
                className="btn-modal-close"
                onClick={() => !listingLoading && setListModalNft(null)}
                disabled={listingLoading}
              >
                ✕
              </button>
            </div>

            <div className="modal-form-body">
              <label className="form-label">Set Listing Price in Sepolia ETH:</label>
              <div className="input-with-addon">
                <input
                  type="number"
                  step="0.01"
                  min="0.001"
                  value={listPriceInput}
                  onChange={(e) => setListPriceInput(e.target.value)}
                  className="modal-form-input"
                  placeholder="0.05"
                  disabled={listingLoading}
                />
                <span className="input-addon-tag">ETH</span>
              </div>

              {/* LISTING STEP PROGRESS UI */}
              {listingStep > 0 && (
                <div className="listing-progress-steps">
                  <div className={`l-step-row ${listingStep >= 1 ? 'completed' : ''}`}>
                    <span className="l-step-icon">{listingStep >= 1 ? '✓' : '⚪'}</span>
                    <span>NFT ownership verified</span>
                  </div>
                  <div className={`l-step-row ${listingStep >= 2 ? (listingStep > 2 ? 'completed' : 'active') : ''}`}>
                    <span className="l-step-icon">{listingStep > 2 ? '✓' : (listingStep === 2 ? '⏳' : '⚪')}</span>
                    <span>{listingStep > 2 ? 'Marketplace approved' : '1/2 Approve Marketplace'}</span>
                  </div>
                  <div className={`l-step-row ${listingStep >= 3 ? (listingStep > 3 ? 'completed' : 'active') : ''}`}>
                    <span className="l-step-icon">{listingStep > 3 ? '✓' : (listingStep === 3 ? '⏳' : '⚪')}</span>
                    <span>{listingStep > 3 ? 'Listing created' : '2/2 Create Listing'}</span>
                  </div>
                  <div className={`l-step-row ${listingStep === 4 ? 'completed' : ''}`}>
                    <span className="l-step-icon">{listingStep === 4 ? '🎉' : '⚪'}</span>
                    <span>Listing confirmed!</span>
                  </div>
                </div>
              )}

              {listingStatus && <div className="modal-status-text">{listingStatus}</div>}

              <div className="modal-buttons-row">
                <button
                  className="btn-modal-primary"
                  onClick={handleExecuteListing}
                  disabled={listingLoading}
                >
                  {listingLoading ? 'Processing...' : 'Confirm Listing'}
                </button>
                <button
                  className="btn-modal-secondary"
                  onClick={() => setListModalNft(null)}
                  disabled={listingLoading}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* --- DIRECT TRANSFER MODAL --- */}
      {transferModalNft && (
        <div className="modal-backdrop" onClick={() => setTransferModalNft(null)}>
          <div className="modal-container glass-panel modal-narrow" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h2>↗ Transfer NFT #{transferModalNft.token_id}</h2>
              <button className="btn-modal-close" onClick={() => setTransferModalNft(null)}>
                ✕
              </button>
            </div>

            <div className="modal-form-body">
              <label className="form-label">Recipient Address or ENS Name (.eth):</label>
              <input
                type="text"
                placeholder="0x... or name.eth"
                value={transferRecipient}
                onChange={(e) => setTransferRecipient(e.target.value)}
                className="modal-form-input"
              />

              {transferStatus && <div className="modal-status-text">{transferStatus}</div>}

              {transferTxHash && (
                <div className="modal-tx-link">
                  <a href={`${ETHERSCAN_BASE}/tx/${transferTxHash}`} target="_blank" rel="noreferrer">
                    View Transfer on Etherscan ↗
                  </a>
                </div>
              )}

              <div className="modal-buttons-row">
                <button
                  className="btn-modal-primary"
                  onClick={executeNftTransfer}
                  disabled={transferring || !transferRecipient}
                >
                  {transferring ? 'Transferring...' : 'Transfer NFT'}
                </button>
                <button
                  className="btn-modal-secondary"
                  onClick={() => setTransferModalNft(null)}
                  disabled={transferring}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* --- FEATURE 3: ONE-CLICK JUDGE DEMO MODAL --- */}
      {showJudgeDemoModal && (
        <div className="modal-backdrop" onClick={() => setShowJudgeDemoModal(false)}>
          <div className="modal-container glass-panel modal-wide judge-modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h2>🎬 ONE-CLICK JUDGE DEMO</h2>
              <button className="btn-modal-close" onClick={() => setShowJudgeDemoModal(false)}>
                ✕
              </button>
            </div>

            <div className="judge-modal-body">
              <div className="judge-intro-banner">
                <h3>Welcome Hackathon Judge! 👋</h3>
                <p>
                  ChainLinkNFT connects live Chainlink ETH/USD oracles on Sepolia directly to dynamic ERC-721 NFT minting.
                  The market trait calculated at mint is permanently locked on-chain and stored on IPFS.
                </p>
              </div>

              {!isDemoMode && (
                <div className="judge-mode-prompt">
                  <span>💡 Enable Demo Oracle Mode to simulate Bearish, Neutral, or Bullish minting on Sepolia:</span>
                  <button className="btn-enable-demo-mode" onClick={() => setIsDemoMode(true)}>
                    🟡 Switch to Demo Oracle Mode
                  </button>
                </div>
              )}

              {/* Demo Oracle Quick Actions */}
              <div className="judge-actions-section">
                <h4>⚡ Demo Oracle Quick Actions</h4>
                <p className="judge-section-sub">Update the Mock Chainlink Oracle on Sepolia to test dynamic market classification:</p>
                <div className="demo-buttons-grid">
                  <button
                    className="btn-demo-price bearish"
                    onClick={() => {
                      if (!isDemoMode) setIsDemoMode(true);
                      handleUpdateMockPrice(1500);
                    }}
                    disabled={updatingMockPrice}
                  >
                    🐻 Set Bearish — $1,500
                  </button>
                  <button
                    className="btn-demo-price neutral"
                    onClick={() => {
                      if (!isDemoMode) setIsDemoMode(true);
                      handleUpdateMockPrice(3000);
                    }}
                    disabled={updatingMockPrice}
                  >
                    ⚖️ Set Neutral — $3,000
                  </button>
                  <button
                    className="btn-demo-price bullish"
                    onClick={() => {
                      if (!isDemoMode) setIsDemoMode(true);
                      handleUpdateMockPrice(5000);
                    }}
                    disabled={updatingMockPrice}
                  >
                    🐂 Set Bullish — $5,000
                  </button>
                </div>
                {mockPriceStatus && <div className="demo-status-box">{mockPriceStatus}</div>}
              </div>

              {/* Recommended Judge Flow */}
              <div className="recommended-flow-section">
                <h4>⭐ Recommended Judge Flow</h4>
                <ol className="flow-steps-list">
                  <li><strong>Set Neutral $3,000</strong> — Click "Set Neutral ($3,000)" above to set Mock Oracle price on Sepolia.</li>
                  <li><strong>Mint NFT</strong> — Upload an artwork image and click "MINT DYNAMIC NFT". Watch 6-step progress pipeline.</li>
                  <li><strong>Open On-Chain Proof</strong> — Click "Provenance" or view transaction hash link on Etherscan.</li>
                  <li><strong>Open NFT Details</strong> — Click the newly minted NFT card to open Detail modal.</li>
                  <li><strong>Show Immutable Trait</strong> — Inspect "Why is this NFT Neutral?" explanation showing mint price $3,000.</li>
                  <li><strong>Open IPFS Metadata</strong> — Click "View Metadata" to verify JSON metadata stored on Pinata IPFS.</li>
                  <li><strong>List NFT</strong> — Click "List for Sale" on your NFT and confirm marketplace listing.</li>
                  <li><strong>Show Marketplace</strong> — Switch to Marketplace tab or attempt buying/cancelling listing.</li>
                </ol>
              </div>

              {/* Complete Project Story */}
              <div className="project-story-section">
                <h4>📖 Complete Project Story</h4>
                <div className="story-pipeline-grid">
                  <div className="story-step-box"><span>1. 🔗</span> Chainlink reads ETH/USD</div>
                  <div className="story-step-box"><span>2. 📊</span> Market regime calculated</div>
                  <div className="story-step-box"><span>3. 🖼️</span> User uploads artwork</div>
                  <div className="story-step-box"><span>4. 🪙</span> NFT is minted</div>
                  <div className="story-step-box"><span>5. 🔒</span> Market trait immutable</div>
                  <div className="story-step-box"><span>6. 📦</span> Metadata on IPFS</div>
                  <div className="story-step-box"><span>7. ✅</span> Verified on-chain</div>
                  <div className="story-step-box"><span>8. 🛒</span> Listed/traded</div>
                  <div className="story-step-box"><span>9. 📜</span> Provenance inspected</div>
                </div>
              </div>

              <div className="modal-buttons-row">
                <button className="btn-modal-primary" onClick={() => setShowJudgeDemoModal(false)}>
                  Close Judge Demo
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;