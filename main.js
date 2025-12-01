import { Buffer } from "buffer";
window.Buffer = window.Buffer || Buffer;

import { ethers } from "ethers";
import { Seaport } from "@opensea/seaport-js";

// ==========================================
// 1. KONFIGÜRASYON VE SABİTLER
// ==========================================

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || "https://testkamo60.onrender.com";
const NFT_CONTRACT_ADDRESS = import.meta.env.VITE_NFT_CONTRACT || "0x54a88333F6e7540eA982261301309048aC431eD5";

// Seaport 1.5 Canonical Address (ApeChain Mainnet & Others)
const SEAPORT_CONTRACT_ADDRESS = "0x0000000000000068F116a894984e2DB1123eB395";

const ZERO_BYTES32 = "0x0000000000000000000000000000000000000000000000000000000000000000";
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

const APECHAIN_ID = 33139;
const APECHAIN_ID_HEX = "0x8173";

let provider = null;
let signer = null;
let seaport = null;
let userAddress = null;

let selectedTokens = new Set();

// UI Elementleri
const connectBtn = document.getElementById("connectBtn");
const disconnectBtn = document.getElementById("disconnectBtn");
const addrSpan = document.getElementById("addr");
const marketplaceDiv = document.getElementById("marketplace");
const noticeDiv = document.getElementById("notice");
const bulkBar = document.getElementById("bulkBar");
const bulkCount = document.getElementById("bulkCount");
const bulkPriceInp = document.getElementById("bulkPrice");
const bulkListBtn = document.getElementById("bulkListBtn");

// ==========================================
// 2. YARDIMCI FONKSİYONLAR (HELPERS)
// ==========================================

function notify(msg, timeout = 4000) {
  if (!noticeDiv) return;
  noticeDiv.textContent = msg;
  console.log(`[BİLDİRİM]: ${msg}`);
  if (timeout) setTimeout(() => { if (noticeDiv.textContent === msg) noticeDiv.textContent = ""; }, timeout);
}

function resolveIPFS(url) {
  if (!url) return "https://i.postimg.cc/Hng3NRg7/Steptract-Logo.png";
  const GATEWAY = "https://cloudflare-ipfs.com/ipfs/";
  let originalUrl = url;
  if (url.startsWith("ipfs://")) {
    originalUrl = url.replace("ipfs://", GATEWAY);
  } else if (url.startsWith("Qm") && url.length >= 46) {
    originalUrl = `${GATEWAY}${url}`;
  }
  return `https://wsrv.nl/?url=${encodeURIComponent(originalUrl)}&w=500&q=75&output=webp&il`;
}

/**
 * CLEAN ORDER (TƏKMİLLƏŞDİRİLMİŞ VERSİYA)
 * Supabase JSONB-dən gələn məlumatı Seaport-un gözlədiyi dəqiq formata salır.
 * Boş dəyərləri (null/undefined) standart dəyərlərlə əvəz edir.
 */
function cleanOrder(orderData) {
  try {
    const order = orderData.order || orderData;
    const { parameters, signature } = order;

    if (!parameters) {
        console.error("Order parameters tapılmadı:", orderData);
        return null;
    }

    const toStr = (val) => {
        if (val === undefined || val === null) return "0";
        if (typeof val === "string" && !val.startsWith("0x")) return val;
        try { return ethers.BigNumber.from(val).toString(); } catch(e) { return String(val); }
    };

    const cleanItems = (items) => items.map(item => ({
        itemType: Number(item.itemType),
        token: item.token,
        identifierOrCriteria: toStr(item.identifierOrCriteria || item.identifier || "0"),
        startAmount: toStr(item.startAmount),
        endAmount: toStr(item.endAmount || item.startAmount), // endAmount yoxdursa startAmount işlət
        recipient: item.recipient || ZERO_ADDRESS // recipient yoxdursa 0x00 işlət
    }));

    return {
      parameters: {
        offerer: parameters.offerer,
        zone: parameters.zone || ZERO_ADDRESS,
        offer: cleanItems(parameters.offer),
        consideration: cleanItems(parameters.consideration),
        orderType: Number(parameters.orderType), 
        startTime: toStr(parameters.startTime),
        endTime: toStr(parameters.endTime),
        zoneHash: parameters.zoneHash || ZERO_BYTES32,
        salt: toStr(parameters.salt),
        conduitKey: parameters.conduitKey || ZERO_BYTES32,
        counter: toStr(parameters.counter),
        totalOriginalConsiderationItems: parameters.totalOriginalConsiderationItems !== undefined 
            ? Number(parameters.totalOriginalConsiderationItems) 
            : parameters.consideration.length
      },
      signature: signature
    };
  } catch (e) { 
      console.error("CleanOrder Xətası:", e);
      return null; 
  }
}

// JSON.stringify edərkən BigNumber xətalarının qarşısını alır
function orderToJsonSafe(obj) {
  return JSON.parse(JSON.stringify(obj, (k, v) => {
    if (v && typeof v === "object") {
      if (ethers.BigNumber.isBigNumber(v)) return v.toString();
      if (v._hex) return ethers.BigNumber.from(v._hex).toString();
    }
    return v;
  }));
}

// ==========================================
// 3. CÜZDAN BAĞLANTISI
// ==========================================

async function connectWallet() {
  try {
    if (!window.ethereum) return alert("Metamask tapılmadı!");
    
    provider = new ethers.providers.Web3Provider(window.ethereum, "any");
    await provider.send("eth_requestAccounts", []);
    
    const network = await provider.getNetwork();
    if (network.chainId !== APECHAIN_ID) {
      try {
        await window.ethereum.request({
          method: "wallet_addEthereumChain",
          params: [{
            chainId: APECHAIN_ID_HEX,
            chainName: "ApeChain Mainnet",
            nativeCurrency: { name: "APE", symbol: "APE", decimals: 18 },
            rpcUrls: [import.meta.env.VITE_APECHAIN_RPC || "https://rpc.apechain.com"],
            blockExplorerUrls: ["https://apescan.io"],
          }],
        });
        // Şəbəkə dəyişdikdən sonra provider-i yeniləyirik
        provider = new ethers.providers.Web3Provider(window.ethereum, "any");
      } catch (e) { return alert("ApeChain şəbəkəsinə keçilmədi."); }
    }

    signer = provider.getSigner();
    userAddress = (await signer.getAddress()).toLowerCase();
    
    // Seaport yalnız düzgün şəbəkədə yaradılır
    seaport = new Seaport(signer, { 
        overrides: { contractAddress: SEAPORT_CONTRACT_ADDRESS } 
    });
    
    connectBtn.style.display = "none";
    disconnectBtn.style.display = "inline-block";
    addrSpan.textContent = `Wallet: ${userAddress.slice(0, 6)}...${userAddress.slice(-4)}`;
    notify("Cüzdan qoşuldu!");
    
    window.ethereum.on("accountsChanged", () => location.reload());

    await loadNFTs();
  } catch (err) { alert("Connect xətası: " + err.message); }
}

disconnectBtn.onclick = () => {
  provider = signer = seaport = userAddress = null;
  connectBtn.style.display = "inline-block";
  disconnectBtn.style.display = "none";
  addrSpan.textContent = "";
  marketplaceDiv.innerHTML = "";
  notify("Çıxış edildi");
};

connectBtn.onclick = connectWallet;

// ==========================================
// 4. NFT YÜKLƏMƏ (LOAD NFTs)
// ==========================================

let loadingNFTs = false;
let allNFTs = [];

async function loadNFTs() {
  if (loadingNFTs) return;
  loadingNFTs = true;
  marketplaceDiv.innerHTML = "<p style='color:black; width:100%; text-align:center;'>NFT-lər yüklənir...</p>";
  
  selectedTokens.clear();
  updateBulkUI();

  try {
    const res = await fetch(`${BACKEND_URL}/api/nfts`);
    const data = await res.json();
    allNFTs = data.nfts || [];
    marketplaceDiv.innerHTML = "";

    if (allNFTs.length === 0) {
      marketplaceDiv.innerHTML = "<p style='color:black; width:100%; text-align:center;'>Hələ NFT yoxdur.</p>";
      return;
    }

    for (const nft of allNFTs) {
      const tokenid = (nft.tokenid || nft.tokenId || "").toString();
      if (!tokenid) continue;

      const name = nft.name || `NFT #${tokenid}`;
      const image = resolveIPFS(nft.image);
      
      const priceVal = parseFloat(nft.price);
      const isListed = (priceVal > 0);
      const displayPrice = isListed ? `${priceVal} APE` : "";

      const seller = nft.seller_address ? nft.seller_address.toLowerCase() : "";
      const currentOwner = nft.buyer_address ? nft.buyer_address.toLowerCase() : "";
      
      let isMine = false;
      if (userAddress) {
          if (isListed) isMine = (seller === userAddress);
          else isMine = (currentOwner === userAddress);
      }

      const card = document.createElement("div");
      card.className = "nft-card";
      
      let checkboxHTML = "";
      if (isMine && !isListed) {
          checkboxHTML = `<input type="checkbox" class="select-box" data-id="${tokenid}">`;
      }

      let actionsHTML = "";
      if (isListed) {
          if (isMine) {
              actionsHTML = `
                <div class="price-val">${displayPrice}</div>
                <button class="action-btn btn-list cancel-btn" disabled>Satışdadır</button>
              `;
          } else {
              actionsHTML = `
                <div class="price-val">${displayPrice}</div>
                <button class="action-btn btn-buy buy-btn">Satın Al</button>
              `;
          }
      } else {
          if (isMine) {
              actionsHTML = `
                 <input type="number" placeholder="Price" class="mini-input price-input" step="0.001">
                 <button class="action-btn btn-list list-btn">Listələ</button>
              `;
          } else {
             actionsHTML = `<span style="font-size:12px; color:#666;">Sahibi: ${currentOwner.slice(0,6)}...</span>`;
          }
      }

      card.innerHTML = `
        ${checkboxHTML}
        <div class="card-image-wrapper">
            <img src="${image}" loading="lazy" decoding="async" onerror="this.src='https://i.postimg.cc/Hng3NRg7/Steptract-Logo.png'">
        </div>
        <div class="card-content">
            <div class="card-title">${name}</div>
            <div class="card-actions">
                ${actionsHTML}
            </div>
        </div>
      `;
      marketplaceDiv.appendChild(card);

      const chk = card.querySelector(".select-box");
      if (chk) {
          chk.onchange = (e) => {
              if (e.target.checked) selectedTokens.add(tokenid);
              else selectedTokens.delete(tokenid);
              updateBulkUI();
          };
      }

      // Buton hadisələri
      if (isListed && !isMine) {
          const buyBtn = card.querySelector(".buy-btn");
          if(buyBtn) buyBtn.onclick = async () => await buyNFT(nft);
      } else if (!isListed && isMine) {
          const listBtn = card.querySelector(".list-btn");
          const priceInp = card.querySelector(".price-input");
          if(listBtn && priceInp) listBtn.onclick = async () => {
             let val = priceInp.value;
             if(!val || isNaN(val) || parseFloat(val) <= 0) return notify("Düzgün qiymət yazın!");
             await listNFT(tokenid, val);
          };
      }
    }
  } catch (err) {
    console.error(err);
    marketplaceDiv.innerHTML = "<p style='color:red; text-align:center;'>Yüklənmə xətası.</p>";
  } finally {
    loadingNFTs = false;
  }
}

// ==========================================
// 5. BULK UI (TOPLU LİSTELEME)
// ==========================================

function updateBulkUI() {
    if (selectedTokens.size > 0) {
        bulkBar.classList.add("active");
        bulkCount.textContent = `${selectedTokens.size} NFT seçildi`;
    } else {
        bulkBar.classList.remove("active");
    }
}

window.cancelBulk = () => {
    selectedTokens.clear();
    document.querySelectorAll(".select-box").forEach(b => b.checked = false);
    updateBulkUI();
};

if(bulkListBtn) {
    bulkListBtn.onclick = async () => {
        let priceVal = bulkPriceInp.value;
        if(priceVal) priceVal = priceVal.trim();
        if (!priceVal || isNaN(priceVal) || parseFloat(priceVal) <= 0) return alert("Toplu satış üçün düzgün qiymət yazın.");
        const tokensArray = Array.from(selectedTokens);
        await bulkListNFTs(tokensArray, priceVal);
    };
}

// ==========================================
// 6. LISTING (SATIŞA ÇIXARMAQ)
// ==========================================

async function listNFT(tokenid, priceInEth) {
  if (!tokenid) return alert("XƏTA: Token ID yoxdur.");
  await bulkListNFTs([tokenid], priceInEth);
}

async function bulkListNFTs(tokenIds, priceInEth) {
    console.log("List Start:", { tokenIds, priceInEth });

    if (!signer || !seaport) return alert("Cüzdan qoşulmayıb!");
    
    // Qiyməti Wei-yə çevir
    let priceWeiString;
    try {
        const safePrice = String(priceInEth).trim();
        const priceBig = ethers.utils.parseEther(safePrice); 
        priceWeiString = priceBig.toString();
    } catch (e) {
        return alert(`Qiymət xətası: ${e.message}`);
    }

    const cleanTokenIds = tokenIds.map(t => String(t));
    const seller = await signer.getAddress();

    // 1. APPROVAL YOXLANIŞI
    try {
        const nftContract = new ethers.Contract(NFT_CONTRACT_ADDRESS, 
            ["function isApprovedForAll(address,address) view returns(bool)", "function setApprovalForAll(address,bool)"], signer);
        
        const isApproved = await nftContract.isApprovedForAll(seller, SEAPORT_CONTRACT_ADDRESS);
        
        if (!isApproved) {
            notify("Kontrakt üçün icazə (Approval) lazımdır...");
            const tx = await nftContract.setApprovalForAll(SEAPORT_CONTRACT_ADDRESS, true);
            notify("Təsdiq gözlənilir...");
            await tx.wait(); 
            notify("İcazə verildi! Orderlər hazırlanır...");
        }
    } catch (e) { return alert("Approve xətası: " + e.message); }

    notify(`${cleanTokenIds.length} NFT üçün imza tələb olunur...`);

    try {
        const startTimeVal = Math.floor(Date.now()/1000).toString();
        const endTimeVal = (Math.floor(Date.now()/1000) + 2592000).toString(); // 30 gün

        // Seaport Order Parametreleri
        const orderInputs = cleanTokenIds.map(tokenStr => {
            return {
                conduitKey: ZERO_BYTES32, 
                offer: [{ 
                    itemType: 2, // ERC721
                    token: NFT_CONTRACT_ADDRESS, 
                    identifier: tokenStr,
                    amount: "1"
                }],
                consideration: [{ 
                    itemType: 0, // NATIVE (APE)
                    token: ZERO_ADDRESS, 
                    identifier: "0", 
                    amount: priceWeiString, 
                    recipient: seller 
                }],
                startTime: startTimeVal,
                endTime: endTimeVal,
            };
        });
        
        // Toplu Order yaradılması
        const { executeAllActions } = await seaport.createBulkOrders(orderInputs, seller);
        const signedOrders = await executeAllActions(); 

        notify("İmza alındı! Verilənlər bazasına yazılır...");

        // Verilənlər bazasına göndərmə
        let successCount = 0;
        for (const order of signedOrders) {
            const offerItem = order.parameters.offer[0];
            const tokenStr = offerItem.identifierOrCriteria;

            // Hash hesabla
            const orderHash = seaport.getOrderHash(order.parameters);
            const plainOrder = orderToJsonSafe(order);

            await fetch(`${BACKEND_URL}/api/order`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    tokenid: tokenStr,
                    price: String(priceInEth),
                    seller_address: seller,
                    seaport_order: plainOrder,
                    order_hash: orderHash,
                    on_chain: false
                }),
            });
            successCount++;
        }

        notify(`Uğurlu! ${successCount} NFT satışa çıxdı.`);
        setTimeout(() => location.reload(), 1500);

    } catch (err) {
        console.error("List Error:", err);
        alert("Satış xətası: " + (err.message || err));
    }
}

// ==========================================
// 7. BUY FUNCTION (SATIN ALMA - FIXED)
// ==========================================

async function buyNFT(nftRecord) {
    if (!signer || !seaport) return alert("Cüzdan qoşulmayıb!");
    
    try {
        const buyerAddress = await signer.getAddress();
        
        if (nftRecord.seller_address && buyerAddress.toLowerCase() === nftRecord.seller_address.toLowerCase()) {
            return alert("Bu NFT artıq sizindir!");
        }

        notify("Order yoxlanılır...");

        let rawJson = nftRecord.seaport_order;
        if (typeof rawJson === "string") { 
            try { rawJson = JSON.parse(rawJson); } catch (e) { return alert("Sistem Xətası: JSON parse xətası"); } 
        }
        
        // 1. Orderi təmizlə (Clean)
        const cleanOrd = cleanOrder(rawJson);
        if (!cleanOrd) return alert("Order strukturu xətalıdır. Listing köhnəlmiş ola bilər.");

        // 2. Hash Yoxlanışı (Debug məqsədli)
        try {
            const calculatedHash = seaport.getOrderHash(cleanOrd.parameters);
            console.log("Calculated Hash:", calculatedHash);
            console.log("Database Hash:  ", nftRecord.order_hash);
            if (calculatedHash !== nftRecord.order_hash) {
                console.warn("DİQQƏT: Hash uyğunsuzluğu! Order bazada zədələnib.");
            }
        } catch (e) { console.log("Hash check warning:", e); }

        notify("Transaction hazırlanır...");

        // 3. Fulfill Order
        const { executeAllActions } = await seaport.fulfillOrders({ 
            fulfillOrderDetails: [{ order: cleanOrd }],
            accountAddress: buyerAddress,
            conduitKey: cleanOrd.parameters.conduitKey 
        });

        notify("Metamask açılır, təsdiq edin...");
        const transaction = await executeAllActions();

        notify("Blokçeyndə təsdiqlənir...");
        await transaction.wait();
        
        notify("Təbrik edirik! NFT alındı.");

        // Baza yeniləməsi
        await fetch(`${BACKEND_URL}/api/buy`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ 
                tokenid: nftRecord.tokenid, 
                order_hash: nftRecord.order_hash, 
                buyer_address: buyerAddress 
            }),
        });
        
        setTimeout(() => location.reload(), 2000);

    } catch (err) {
        console.error("Buy Error Full:", err);
        let msg = err.message || JSON.stringify(err);
        
        if (msg.includes("Invalid Signature") || msg.includes("reverted")) {
            msg = "Listing keçərsizdir (İmza səhvi). Satıcı listingi ləğv etmiş ola bilər və ya verilənlər bazası uyğunsuzluğu var.";
        } else if (msg.includes("insufficient funds")) {
            msg = "Balansınız kifayət etmir (APE + Gas).";
        } else if (msg.includes("user rejected")) {
            msg = "İşləm ləğv edildi.";
        }
        alert("Xəta: " + msg);
    }
}

// Global window funksiyası
window.loadNFTs = loadNFTs;
