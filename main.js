import { Buffer } from "buffer";
window.Buffer = window.Buffer || Buffer;

import { ethers } from "ethers";
import { Seaport } from "@opensea/seaport-js";

// ==========================================
// SABİTLƏR (CONSTANTS)
// ==========================================

const ItemType = {
    NATIVE: 0,
    ERC20: 1,
    ERC721: 2,
    ERC1155: 3
};

const OrderType = {
    FULL_OPEN: 0,     // Zone yoxdur, hər kəs ala bilər (Ən təhlükəsiz)
    PARTIAL_OPEN: 1,
    FULL_RESTRICTED: 2,
    PARTIAL_RESTRICTED: 3
};

// ==========================================
// KONFIQURASIYA
// ==========================================

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || "https://testkamo66.onrender.com";
const NFT_CONTRACT_ADDRESS = import.meta.env.VITE_NFT_CONTRACT || "0x54a88333f6e7540ea982261301309048ac431ed5";

// Seaport 1.6 Canonical Address
const SEAPORT_ADDRESS = "0x0000000000000068f116a894984e2db1123eb395"; 

const ZERO_BYTES32 = "0x0000000000000000000000000000000000000000000000000000000000000000";
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

const APECHAIN_ID = 33139;
const APECHAIN_ID_HEX = "0x8173";

let provider = null;
let signer = null;
let seaport = null;
let userAddress = null;

let selectedTokens = new Set();

// UI Elementləri
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
// KÖMƏKÇİ FUNKSİYALAR
// ==========================================

function notify(msg, timeout = 3000) {
  if (!noticeDiv) return;
  noticeDiv.textContent = msg;
  console.log(`[NOTIFY]: ${msg}`);
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

// Order təmizləmə
function cleanOrder(orderData) {
  try {
    const order = orderData.order || orderData;
    const { parameters, signature } = order;

    if (!parameters) {
        console.error("Order parameters not found:", orderData);
        return null;
    }

    const toStr = (val) => {
        if (val === undefined || val === null) return "0";
        if (typeof val === "object" && val.hex) return BigInt(val.hex).toString();
        return val.toString();
    };

    return {
      parameters: {
        offerer: parameters.offerer,
        zone: parameters.zone,
        offer: parameters.offer.map(item => ({
          itemType: Number(item.itemType), 
          token: item.token,
          identifierOrCriteria: toStr(item.identifierOrCriteria || item.identifier),
          startAmount: toStr(item.startAmount),
          endAmount: toStr(item.endAmount)
        })),
        consideration: parameters.consideration.map(item => ({
          itemType: Number(item.itemType), 
          token: item.token,
          identifierOrCriteria: toStr(item.identifierOrCriteria || item.identifier),
          startAmount: toStr(item.startAmount),
          endAmount: toStr(item.endAmount),
          recipient: item.recipient
        })),
        orderType: Number(parameters.orderType), 
        startTime: toStr(parameters.startTime),
        endTime: toStr(parameters.endTime),
        zoneHash: parameters.zoneHash,
        salt: toStr(parameters.salt),
        conduitKey: parameters.conduitKey,
        counter: toStr(parameters.counter),
        totalOriginalConsiderationItems: Number(
            parameters.totalOriginalConsiderationItems !== undefined 
            ? parameters.totalOriginalConsiderationItems 
            : parameters.consideration.length
        )
      },
      signature: signature
    };
  } catch (e) { 
      console.error("CleanOrder Error:", e);
      return null; 
  }
}

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
// CÜZDAN QOŞULMASI
// ==========================================

async function connectWallet() {
  try {
    if (!window.ethereum) return alert("Metamask tapılmadı!");
    provider = new ethers.providers.Web3Provider(window.ethereum, "any");
    
    // Zəncir yoxlanışı
    const { chainId } = await provider.getNetwork();
    if (chainId !== APECHAIN_ID) {
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
        provider = new ethers.providers.Web3Provider(window.ethereum, "any");
      } catch (e) { return alert("ApeChain şəbəkəsinə keçilmədi."); }
    }

    await provider.send("eth_requestAccounts", []);
    signer = provider.getSigner();

    // ============================================================
    // FIX: Ethers v5 üçün signTypedData Patch (SİZİN XƏTANI DÜZƏLDƏN HİSSƏ)
    // ============================================================
    if (!signer.signTypedData) {
        signer.signTypedData = async (domain, types, value) => {
            // Ethers v5 'EIP712Domain' tipini avtomatik əlavə edir,
            // əgər Seaport onu yenidən göndərirsə, konflikt yaranır.
            const typesCopy = { ...types };
            delete typesCopy.EIP712Domain; 
            
            // Gizli _signTypedData funksiyasını çağırırıq
            return await signer._signTypedData(domain, typesCopy, value);
        };
    }
    // ============================================================

    userAddress = (await signer.getAddress()).toLowerCase();
    
    // SEAPORT INITIALIZATION
    seaport = new Seaport(signer, { 
        overrides: { 
            contractAddress: SEAPORT_ADDRESS,
            defaultConduitKey: ZERO_BYTES32 
        } 
    });
    
    connectBtn.style.display = "none";
    disconnectBtn.style.display = "inline-block";
    addrSpan.textContent = `Wallet: ${userAddress.slice(0, 6)}...${userAddress.slice(-4)}`;
    notify("Cüzdan qoşuldu!");

    window.ethereum.on("accountsChanged", () => location.reload());
    window.ethereum.on("chainChanged", () => location.reload());

    await loadNFTs();
  } catch (err) { 
      console.error(err);
      alert("Connect xətası: " + err.message); 
  }
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
// NFT YÜKLƏMƏ
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

    let nftContractRead = null;
    if (provider) {
       nftContractRead = new ethers.Contract(NFT_CONTRACT_ADDRESS, ["function ownerOf(uint256) view returns (address)"], provider);
    }

    for (const nft of allNFTs) {
      const tokenidRaw = (nft.tokenid !== undefined && nft.tokenid !== null) ? nft.tokenid : nft.tokenId;
      
      if (tokenidRaw === undefined || tokenidRaw === null) continue;
      const tokenid = tokenidRaw.toString(); 

      const name = nft.name || `NFT #${tokenid}`;
      const image = resolveIPFS(nft.image);
      
      let displayPrice = "";
      let priceVal = 0;
      let isListed = false;

      if (nft.price && parseFloat(nft.price) > 0) {
        priceVal = parseFloat(nft.price);
        displayPrice = `${priceVal} APE`;
        isListed = true;
      }

      let realOwner = null;
      if (nftContractRead) {
          try { realOwner = await nftContractRead.ownerOf(tokenid); } catch(e) {}
      }

      const isMine = (userAddress && realOwner && userAddress.toLowerCase() === realOwner.toLowerCase());
      const dbSellerMatch = (userAddress && nft.seller_address && userAddress.toLowerCase() === nft.seller_address.toLowerCase());
      const isSeller = isMine || (dbSellerMatch && isListed); 
      
      const canManage = isMine; 

      const card = document.createElement("div");
      card.className = "nft-card";
      
      let checkboxHTML = "";
      if (canManage) {
          checkboxHTML = `<input type="checkbox" class="select-box" data-id="${tokenid}">`;
      }

      let actionsHTML = "";
      if (isListed) {
          if (canManage) {
              actionsHTML = `
                <div style="font-size:12px; color:green;">Listed</div>
                <input type="number" placeholder="New Price" class="mini-input price-input" step="0.001">
                <button class="action-btn btn-list update-btn">Update</button>
              `;
          } else {
              actionsHTML = `<button class="action-btn btn-buy buy-btn">Buy</button>`;
          }
      } else {
          if (canManage) {
              actionsHTML = `
                 <input type="number" placeholder="Price" class="mini-input price-input" step="0.001">
                 <button class="action-btn btn-list list-btn">List</button>
              `;
          }
      }

      card.innerHTML = `
        ${checkboxHTML}
        <div class="card-image-wrapper">
            <img src="${image}" loading="lazy" decoding="async" onerror="this.src='https://i.postimg.cc/Hng3NRg7/Steptract-Logo.png'">
        </div>
        <div class="card-content">
            <div class="card-title">${name}</div>
            <div class="card-details">
                 ${displayPrice ? `<div class="price-val">${displayPrice}</div>` : `<div style="height:24px"></div>`}
            </div>
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

      if (actionsHTML !== "") {
          const priceInput = card.querySelector(".price-input");
          
          if (isListed && !canManage) {
             const btn = card.querySelector(".buy-btn");
             if(btn) btn.onclick = async () => await buyNFT(nft);
          } else {
             const btn = card.querySelector(".list-btn") || card.querySelector(".update-btn");
             if(btn) btn.onclick = async () => {
                 let inp = priceInput.value;
                 if(inp) inp = inp.trim();
                 if(!inp || isNaN(inp) || parseFloat(inp) <= 0) return notify("Düzgün qiymət yazın!");
                 await listNFT(tokenid, inp);
             };
          }
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
// TOPLU UI & FUNKSİYALAR
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
// LISTING (SATIŞA ÇIXARMAQ)
// ==========================================

async function listNFT(tokenid, priceInEth) {
  if (tokenid === undefined || tokenid === null) {
      alert("XƏTA: Token ID təyin edilməyib. Səhifəni yeniləyin.");
      return;
  }
  await bulkListNFTs([tokenid], priceInEth);
}

async function bulkListNFTs(tokenIds, priceInEth) {
    console.log("List Start:", { tokenIds, priceInEth });

    if (!signer || !seaport) return alert("Cüzdan qoşulmayıb!");
    
    if (!priceInEth || String(priceInEth).trim() === "") return alert("Qiymət boşdur.");

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

    // Approve Prosesi
    try {
        const nftContract = new ethers.Contract(NFT_CONTRACT_ADDRESS, 
            ["function isApprovedForAll(address,address) view returns(bool)", "function setApprovalForAll(address,bool)"], signer);
        
        const isApproved = await nftContract.isApprovedForAll(seller, SEAPORT_ADDRESS);
        if (!isApproved) {
            notify("Satış kontraktı təsdiq olunur...");
            const tx = await nftContract.setApprovalForAll(SEAPORT_ADDRESS, true);
            await tx.wait();
            notify("Təsdiqləndi!");
        }
    } catch (e) { return alert("Approve xətası: " + e.message); }

    notify(`${cleanTokenIds.length} NFT orderi imzalanır...`);

    try {
        const startTimeVal = Math.floor(Date.now()/1000).toString(); 
        const endTimeVal = (Math.floor(Date.now()/1000) + 15552000).toString(); // 6 ay

        const orderInputs = cleanTokenIds.map(tokenStr => {
            return {
                // KRITIK: OrderType 0 = FULL_OPEN (Zone yoxdur)
                orderType: OrderType.FULL_OPEN,
                zone: ZERO_ADDRESS,
                zoneHash: ZERO_BYTES32,
                conduitKey: ZERO_BYTES32, 
                
                offer: [{ 
                    itemType: ItemType.ERC721,
                    token: NFT_CONTRACT_ADDRESS, 
                    identifier: tokenStr,
                    amount: "1"
                }],
                consideration: [{ 
                    itemType: ItemType.NATIVE, // APE
                    token: ZERO_ADDRESS, 
                    identifier: "0", 
                    amount: priceWeiString, 
                    recipient: seller 
                }],
                startTime: startTimeVal,
                endTime: endTimeVal,
            };
        });

        notify("Zəhmət olmasa cüzdanda imzalayın...");
        
        // Bu funksiya artıq bizim patch edilmiş signTypedData-nı istifadə edəcək
        const { executeAllActions } = await seaport.createBulkOrders(orderInputs, seller);
        const signedOrders = await executeAllActions(); 

        notify("İmza alındı! Bazaya yazılır...");

        let successCount = 0;
        for (const order of signedOrders) {
            const offerItem = order.parameters.offer[0];
            const tokenStr = offerItem.identifierOrCriteria;

            const plainOrder = orderToJsonSafe(order);
            const orderHash = seaport.getOrderHash(order.parameters);

            await fetch(`${BACKEND_URL}/api/order`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    tokenid: tokenStr,
                    price: String(priceInEth),
                    seller_address: seller,
                    seaport_order: plainOrder,
                    order_hash: orderHash,
                    status: "active"
                }),
            });
            successCount++;
        }

        notify(`Tamamlandı! ${successCount} NFT satışa çıxdı.`);
        setTimeout(() => location.reload(), 1500);

    } catch (err) {
        console.error("List Error:", err);
        alert("Satış xətası: " + (err.message || err));
    }
}

// ==========================================
// BUY FUNCTION
// ==========================================

async function buyNFT(nftRecord) {
    if (!signer || !seaport) return alert("Cüzdan qoşulmayıb!");
    
    try {
        const buyerAddress = await signer.getAddress();
        
        const nftContract = new ethers.Contract(NFT_CONTRACT_ADDRESS, ["function ownerOf(uint256) view returns (address)"], provider);
        try {
            const owner = await nftContract.ownerOf(nftRecord.tokenid);
            if (owner.toLowerCase() === buyerAddress.toLowerCase()) return alert("Bu NFT artıq sizindir!");
        } catch(e) {}

        notify("Order hazırlanır...");
        let rawJson = nftRecord.seaport_order;
        if (!rawJson) return alert("Order tapılmadı.");
        
        if (typeof rawJson === "string") { 
            try { rawJson = JSON.parse(rawJson); } catch (e) { return alert("JSON Parse Xətası"); } 
        }

        const cleanOrd = cleanOrder(rawJson);
        if (!cleanOrd) return alert("Order strukturu xətalıdır");

        const currentT = Math.floor(Date.now()/1000);
        if(Number(cleanOrd.parameters.endTime) < currentT) {
             return alert("Bu orderin vaxtı bitib.");
        }

        const { actions } = await seaport.fulfillOrder({ 
            order: cleanOrd, 
            accountAddress: buyerAddress,
            conduitKey: ZERO_BYTES32 
        });

        const txRequest = await actions[0].transactionMethods.buildTransaction();

        // Value Hesablanması (APE - Native)
        let finalValue = ethers.BigNumber.from(0);
        if (cleanOrd.parameters.consideration) {
            cleanOrd.parameters.consideration.forEach(c => {
                // ItemType 0 = Native (APE)
                if (Number(c.itemType) === 0) { 
                     finalValue = finalValue.add(ethers.BigNumber.from(c.startAmount));
                }
            });
        }
        
        if (txRequest.value && ethers.BigNumber.from(txRequest.value).gt(finalValue)) {
            finalValue = ethers.BigNumber.from(txRequest.value);
        }

        // TƏHLÜKƏSİZ GAS LİMİTİ (L3 Orbit Chain Fix)
        let gasLimit;
        try {
            const est = await signer.estimateGas({ 
                to: txRequest.to,
                data: txRequest.data,
                value: finalValue, 
                from: buyerAddress 
            });
            gasLimit = est.mul(140).div(100); 
        } catch(e) {
            console.warn("Gas estimate failed, forcing manual high limit.", e.message);
            gasLimit = ethers.BigNumber.from("500000"); 
        }

        notify("Metamask-da təsdiqləyin...");
        const tx = await signer.sendTransaction({
            to: txRequest.to,
            data: txRequest.data,
            value: finalValue,
            gasLimit: gasLimit
        });

        notify("Blokçeyndə təsdiqlənir...");
        await tx.wait();
        notify("Uğurlu alış!");

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
        console.error("Buy Error Details:", err);
        let msg = err.message || err;
        
        if (msg.includes("insufficient funds")) msg = "Balansınız kifayət etmir (Gas + Qiymət).";
        else if (msg.includes("user rejected")) msg = "İmtina edildi.";
        else if (msg.includes("ZoneDenied")) msg = "Xəta: Zone tərəfindən rədd edildi (Köhnə listing).";
        else if (msg.includes("InvalidMsgValue")) msg = "Xəta: Göndərilən APE miqdarı yanlışdır.";
        
        alert("Buy Xətası: " + msg);
    }
}

window.loadNFTs = loadNFTs;
