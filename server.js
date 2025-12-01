import express from "express";
import cors from "cors";
import helmet from "helmet";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

// .env konfiqurasiyasını yükləyirik
dotenv.config();

// Sabitlər (Constants) - .env faylından oxuyuruq
const NFT_CONTRACT_ADDRESS = process.env.NFT_CONTRACT_ADDRESS;
const SEAPORT_CONTRACT_ADDRESS = process.env.SEAPORT_CONTRACT_ADDRESS;

// Supabase Client
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(helmet({ contentSecurityPolicy: false })); 
app.use(cors());
app.use(express.json({ limit: "10mb" })); // Böyük JSON payloadları üçün limit artırıldı

// Static fayllar (Frontend build)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const distPath = path.join(__dirname, "dist");
app.use(express.static(distPath));

// =============================================
// API ROUTES
// =============================================

// 1. NFT Listini Gətir (Fetch All)
app.get("/api/nfts", async (req, res) => {
  // Frontend-dəki 'allNFTs' bura sorğu göndərir
  const { data, error } = await supabase
    .from("metadata")
    .select("*")
    .order("tokenid", { ascending: true });

  if (error) return res.status(500).json({ error: error.message });
  res.json({ nfts: data });
});

// 2. Order Yarat (List NFT) - ƏSAS DÜZƏLİŞ BURADADIR
app.post("/api/order", async (req, res) => {
  const { tokenid, price, seller_address, seaport_order, order_hash } = req.body;
  
  if (!tokenid || !seaport_order) return res.status(400).json({ error: "Missing data" });

  // MAPPING: Javascript dəyişənlərini DB sütunlarına uyğunlaşdırırıq
  const { error } = await supabase.from("metadata").upsert({
    tokenid: tokenid.toString(),
    price: price,
    
    // Front-enddən gələn seller (satıcı)
    // DİQQƏT: Bazada 'metadata' cədvəlində 'seller_address' sütunu olmalıdır!
    seller_address: seller_address.toLowerCase(), 

    seaport_order: seaport_order,
    order_hash: order_hash,
    
    // Serverdəki sabitlər -> Bazadakı sütunlara
    nft_contract: NFT_CONTRACT_ADDRESS,          
    marketplace_contract: SEAPORT_CONTRACT_ADDRESS, 

    buyer_address: null, // Satışa çıxıbsa, alıcı hələ yoxdur
    on_chain: false,     // Seaport listing off-chain prosesdir
    updatedat: new Date().toISOString()
  }, { onConflict: "tokenid" });

  if (error) {
      console.error("Order Save Error:", error.message);
      return res.status(500).json({ error: error.message });
  }
  
  res.json({ success: true });
});

// 3. Satış Tamamlandı (Buy Complete)
app.post("/api/buy", async (req, res) => {
  const { tokenid, buyer_address } = req.body;
  
  if (!tokenid || !buyer_address) return res.status(400).json({ error: "Missing buying data" });

  // Satış bitdi: Listing məlumatlarını təmizləyirik və yeni sahibi yazırıq
  const { error } = await supabase.from("metadata").update({
    buyer_address: buyer_address.toLowerCase(),
    seller_address: null, // Artıq satıcı yoxdur, NFT sahibinindir
    price: 0,
    seaport_order: null,
    order_hash: null,
    on_chain: true, // Sahibi dəyişdiyi üçün bu on-chain əməliyyatdır
    updatedat: new Date().toISOString()
  }).eq("tokenid", tokenid.toString());

  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

// =============================================
// SPA Fallback (Həmişə ən sonda olmalıdır)
// =============================================
app.get("*", (req, res) => {
  res.sendFile(path.join(distPath, "index.html"));
});

app.listen(PORT, () => console.log(`🚀 Backend running on port ${PORT}`));
