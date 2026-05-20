import React, { useState, useEffect, useRef } from 'react';
import { Coins, CheckCircle2, Copy, AlertTriangle, Anchor, ArrowRight, Loader2, Info } from 'lucide-react';
import {
  generateSolWallet, sweepSol, getSolBalance, MAIN_WALLETS,
  generateEthWallet, sweepEth, getEthBalance,
  generateBtcWallet, sweepBtc, getBtcBalance,
  getUsdtBalance, getUsdtEphemeralBalance
} from '../lib/crypto';
import { Connection } from '@solana/web3.js';
import { ethers } from 'ethers';

const USD_PER_TICKET = 1;

interface ParsedTx {
  signature: string;
  amountUsd: number;
  time: string;
  isDeposit: boolean;
  currency: 'SOL' | 'ETH' | 'BTC' | 'USDT';
  timestamp: number;
}

export default function Home() {
  const [prices, setPrices] = useState({ sol: 0, eth: 0, btc: 0, usdt: 1 });
  const [balances, setBalances] = useState({ sol: 0, eth: 0, btc: 0, usdt: 0 });
  const [transactions, setTransactions] = useState<ParsedTx[]>([]);
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(true);

  // New Deposit System State
  const [currency, setCurrency] = useState<'SOL' | 'ETH' | 'BTC' | 'USDT'>('BTC');
  const [payoutAddress, setPayoutAddress] = useState('');

  const [ephemeralWallet, setEphemeralWallet] = useState<any>(null);
  const [ephemeralAddress, setEphemeralAddress] = useState('');
  const [ephemeralBalance, setEphemeralBalance] = useState<number>(0);

  const [isSweeping, setIsSweeping] = useState(false);
  const [sweepSuccess, setSweepSuccess] = useState(false);
  const [ticketsEarned, setTicketsEarned] = useState(0);

  // Login System State
  const [loginAddress, setLoginAddress] = useState('');
  const [userTickets, setUserTickets] = useState<number | null>(null);
  const [poolPercentage, setPoolPercentage] = useState<number | null>(null);
  const [loadingLogin, setLoadingLogin] = useState(false);

  useEffect(() => {
    let active = true;

    const fetchData = async () => {
      try {
        // Fetch Prices
        const priceRes = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=solana,ethereum,bitcoin,tether&vs_currencies=usd');
        const priceData = await priceRes.json();
        const p = {
          sol: priceData.solana?.usd || 0,
          eth: priceData.ethereum?.usd || 0,
          btc: priceData.bitcoin?.usd || 0,
          usdt: priceData.tether?.usd || 1
        };
        if (active) setPrices(p);

        // Fetch Balances
        const [solBal, ethBal, btcBal, usdtBal] = await Promise.all([
          getSolBalance(), getEthBalance(), getBtcBalance(), getUsdtBalance()
        ]);
        if (active) setBalances({ sol: solBal, eth: ethBal, btc: btcBal, usdt: usdtBal });

        // Fetch Transactions (Simplified for demo, fetching SOL and BTC, mocking ETH if needed)
        let txs: ParsedTx[] = [];

        try {
          const solConn = new Connection('https://solana-rpc.publicnode.com', 'confirmed');
          const solSigs = await solConn.getSignaturesForAddress(new (await import('@solana/web3.js')).PublicKey(MAIN_WALLETS.SOL), { limit: 5 });
          for (const sig of solSigs) {
            txs.push({
              signature: sig.signature,
              amountUsd: 0, // We would parse the tx to get exact amount, mocking for speed in this demo
              time: new Date((sig.blockTime || 0) * 1000).toLocaleString(),
              isDeposit: true,
              currency: 'SOL',
              timestamp: sig.blockTime || 0
            });
          }
        } catch (e) { }

        try {
          const btcRes = await fetch(`https://mempool.space/api/address/${MAIN_WALLETS.BTC}/txs`);
          const btcData = await btcRes.json();
          for (const tx of btcData.slice(0, 5)) {
            txs.push({
              signature: tx.txid,
              amountUsd: 0,
              time: new Date(tx.status.block_time * 1000).toLocaleString(),
              isDeposit: true,
              currency: 'BTC',
              timestamp: tx.status.block_time
            });
          }
        } catch (e) { }

        if (active) {
          setTransactions(txs.sort((a, b) => b.timestamp - a.timestamp));
          setLoading(false);
        }
      } catch (err) {
        console.error("Error fetching data:", err);
        if (active) setLoading(false);
      }
    };

    fetchData();
    const intervalId = setInterval(fetchData, 60000);

    // Sync localStorage fallbacks to Firebase
    const syncFallbacks = async () => {
      const fallbacksRaw = localStorage.getItem('ticket_fallbacks');
      if (!fallbacksRaw) return;
      try {
        const fallbacks = JSON.parse(fallbacksRaw);
        if (fallbacks.length === 0) return;

        const { collection, addDoc } = await import('firebase/firestore');
        const { db } = await import('../lib/firebase');

        const remaining = [...fallbacks];
        for (let i = 0; i < fallbacks.length; i++) {
          const entry = fallbacks[i];
          try {
            await addDoc(collection(db, 'entries'), entry);
            remaining.shift(); // remove successfully written entry
          } catch (err) {
            console.error("Failed to sync fallback entry:", err);
            break; // Stop syncing if there is a network issue
          }
        }
        if (remaining.length === 0) {
          localStorage.removeItem('ticket_fallbacks');
          console.log("All local ticket fallbacks synced to Firebase successfully.");
        } else {
          localStorage.setItem('ticket_fallbacks', JSON.stringify(remaining));
        }
      } catch (e) {
        console.error("Error syncing fallbacks:", e);
      }
    };
    setTimeout(syncFallbacks, 3000);

    return () => { active = false; clearInterval(intervalId); };
  }, []);

  // Poll ephemeral wallet balance
  useEffect(() => {
    if (!ephemeralAddress || isSweeping || sweepSuccess) return;

    let active = true;

    const checkBalance = async () => {
      try {
        let bal = 0;
        if (currency === 'SOL') {
          const solConn = new Connection('https://solana-rpc.publicnode.com', 'confirmed');
          bal = await solConn.getBalance(new (await import('@solana/web3.js')).PublicKey(ephemeralAddress));
        } else if (currency === 'ETH') {
          const ethProvider = new ethers.JsonRpcProvider('https://cloudflare-eth.com');
          bal = Number(ethers.formatEther(await ethProvider.getBalance(ephemeralAddress)));
        } else if (currency === 'BTC') {
          const res = await fetch(`https://mempool.space/api/address/${ephemeralAddress}`);
          const data = await res.json();
          bal = (data.chain_stats.funded_txo_sum - data.chain_stats.spent_txo_sum) / 1e8;
          if (bal === 0 && data.mempool_stats.funded_txo_sum > 0) {
            // Count unconfirmed for sweeping
            bal = data.mempool_stats.funded_txo_sum / 1e8;
          }
        } else if (currency === 'USDT') {
          bal = await getUsdtEphemeralBalance(ephemeralAddress);
        }

        if (active && bal > 0 && !isSweeping && !sweepSuccess) {
          setEphemeralBalance(bal);
          handleSweep();
        }
      } catch (error) {
        console.error("Poll Error:", error);
      }
    };

    const pollInterval = setInterval(checkBalance, 5000);
    return () => { active = false; clearInterval(pollInterval); };
  }, [ephemeralAddress, isSweeping, sweepSuccess, currency]);

  const handleGenerateDeposit = () => {
    const address = payoutAddress.trim();
    if (!address) {
      alert("Invalid Payout Address");
      return;
    }

    try {
      if (currency === 'SOL') {
        const { keypair, address: addr } = generateSolWallet();
        setEphemeralWallet(keypair);
        setEphemeralAddress(addr);
      } else if (currency === 'ETH') {
        const { wallet, address: addr } = generateEthWallet();
        setEphemeralWallet(wallet);
        setEphemeralAddress(addr);
      } else if (currency === 'BTC') {
        const { keyPair, address: addr } = generateBtcWallet();
        setEphemeralWallet(keyPair);
        setEphemeralAddress(addr);
      } else if (currency === 'USDT') {
        // USDT is ERC-20 on Ethereum, reuse ETH wallet
        const { wallet, address: addr } = generateEthWallet();
        setEphemeralWallet(wallet);
        setEphemeralAddress(addr);
      }
      setSweepSuccess(false);
      setIsSweeping(false);
      setEphemeralBalance(0);
    } catch (e) {
      console.error(e);
      alert("Error generating wallet. Ensure polyfills are loaded.");
    }
  };

  const handleSweep = async () => {
    if (!ephemeralWallet) return;
    setIsSweeping(true);

    try {
      let txHash = '';
      let sweepAmount = 0;
      let balanceBeforeFee = 0;

      if (currency === 'SOL') {
        const res = await sweepSol(ephemeralWallet);
        txHash = res.txHash;
        sweepAmount = res.sweepAmount / 1e9; // lamports to sol
        balanceBeforeFee = res.balance / 1e9;
      } else if (currency === 'ETH') {
        const res = await sweepEth(ephemeralWallet);
        txHash = res.txHash;
        sweepAmount = res.sweepAmount;
        balanceBeforeFee = res.balance;
      } else if (currency === 'BTC') {
        const res = await sweepBtc(ephemeralWallet);
        txHash = res.txHash;
        sweepAmount = res.sweepAmount;
        balanceBeforeFee = res.balance;
      } else if (currency === 'USDT') {
        // USDT is ERC-20: can't auto-sweep without gas ETH.
        // Record the deposit — admin sweeps later.
        balanceBeforeFee = await getUsdtEphemeralBalance(ephemeralAddress);
        sweepAmount = balanceBeforeFee;
        txHash = 'pending-usdt-sweep';
      }

      // Calculate USD Value and Tickets
      const usdValue = balanceBeforeFee * (prices[currency.toLowerCase() as keyof typeof prices] || 0);
      const numTickets = usdValue / USD_PER_TICKET;

      const normalizedPayout = payoutAddress.trim().toLowerCase().startsWith('0x')
        ? payoutAddress.trim().toLowerCase()
        : payoutAddress.trim();

      const entryDoc = {
        payoutAddress: normalizedPayout,
        depositAddress: ephemeralAddress,
        amount: balanceBeforeFee,
        currency: currency,
        usdValue: usdValue,
        tickets: numTickets,
        txHash: txHash,
        timestamp: new Date().toISOString()
      };

      const { collection, addDoc } = await import('firebase/firestore');
      const { db } = await import('../lib/firebase');

      const addDocPromise = addDoc(collection(db, 'entries'), entryDoc);
      const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 10000));

      try {
        await Promise.race([addDocPromise, timeoutPromise]);
      } catch (err: any) {
        console.error("Firebase write failed, saving to localStorage:", err);
        const fallbacks = JSON.parse(localStorage.getItem('ticket_fallbacks') || '[]');
        fallbacks.push(entryDoc);
        localStorage.setItem('ticket_fallbacks', JSON.stringify(fallbacks));
        alert(`Warning: Database offline. We secured your tickets locally. Tx: ${txHash}`);
      }

      setTicketsEarned(numTickets);
      setSweepSuccess(true);
    } catch (e: any) {
      console.error("Sweep Error:", e);
      alert(`Error securing tickets: ${e?.message || 'Please contact support.'}`);
    } finally {
      setIsSweeping(false);
    }
  };

  const handleLogin = async () => {
    let address = loginAddress.trim();
    if (!address) {
      alert("Invalid Address");
      return;
    }
    if (address.toLowerCase().startsWith('0x')) {
      address = address.toLowerCase();
    }
    setLoadingLogin(true);
    try {
      const { collection, query, where, getDocs } = await import('firebase/firestore');
      const { db } = await import('../lib/firebase');

      const qUser = query(collection(db, 'entries'), where('payoutAddress', '==', address));
      const snapshotUser = await getDocs(qUser);

      let totalUserTix = 0;
      snapshotUser.forEach(doc => { totalUserTix += doc.data().tickets; });

      setUserTickets(totalUserTix);

      const qAll = query(collection(db, 'entries'));
      const snapshotAll = await getDocs(qAll);

      let totalAllTix = 0;
      snapshotAll.forEach(doc => { totalAllTix += doc.data().tickets; });

      setPoolPercentage(totalAllTix > 0 ? (totalUserTix / totalAllTix) * 100 : 0);
    } catch (e: any) {
      console.error("Login Error:", e);
      alert(`Error checking tickets: ${e?.message || 'Database connection error'}`);
    } finally {
      setLoadingLogin(false);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const totalPoolUsd = (balances.sol * prices.sol) + (balances.eth * prices.eth) + (balances.btc * prices.btc) + (balances.usdt * prices.usdt);
  const totalPoolBtc = prices.btc > 0 ? totalPoolUsd / prices.btc : 0;
  const formattedPrizePoolBtc = totalPoolBtc.toLocaleString('en-US', { minimumFractionDigits: 8, maximumFractionDigits: 8 }) + ' BTC';
  const formattedPrizePoolUsd = totalPoolUsd.toLocaleString('en-US', { style: 'currency', currency: 'USD' });

  return (
    <div className="min-h-screen bg-[#faf9f6] text-[#0f172a] font-sans selection:bg-yellow-400 selection:text-black pb-20">
      <nav className="sticky top-0 z-50 bg-[#faf9f6] border-b-4 border-black p-4 flex justify-between items-center px-4 md:px-8">
        <div className="flex items-center gap-2">
          <div className="bg-yellow-400 border-2 border-black p-1.5 rounded-sm shadow-retro">
            <Coins className="w-6 h-6 stroke-[2.5px]" />
          </div>
          <span className="text-2xl font-bold tracking-tight">BIT<span className="text-yellow-500">LOTTERY</span></span>
        </div>
      </nav>



      <section className="pt-12 pb-6 px-4 flex justify-center">
        <div className="bg-white border-4 border-black p-8 md:p-12 rounded-xl shadow-retro-lg text-center w-full max-w-4xl relative overflow-hidden">
          <div className="absolute top-0 left-0 w-full h-2 bg-yellow-400"></div>
          <h2 className="text-xl font-bold text-gray-500 uppercase tracking-widest mb-4 flex items-center justify-center gap-2">
            <span className="w-3 h-3 rounded-full bg-orange-500 animate-pulse"></span>
            Live BTC Prize Pool
          </h2>

          {loading && totalPoolUsd === 0 ? (
            <div className="animate-pulse h-36 bg-gray-100 rounded-lg max-w-sm mx-auto mb-4 border-2 border-dashed border-gray-300"></div>
          ) : (
            <div className="flex flex-col items-center justify-center">
              <div className="text-5xl sm:text-6xl md:text-[6rem] font-black text-orange-500 drop-shadow-[4px_4px_0_rgba(0,0,0,1)] font-mono tracking-tighter leading-none py-4">
                {formattedPrizePoolBtc}
              </div>
              <div className="text-2xl font-bold text-gray-400 mt-2 font-mono">
                ≈ {formattedPrizePoolUsd}
              </div>
            </div>
          )}
        </div>
      </section>

      <header className="px-4 py-8 max-w-3xl mx-auto flex flex-col items-center text-center">
        <h1 className="text-3xl md:text-4xl font-black uppercase tracking-tighter mb-4 leading-tight">
          The world's premier crypto lottery
        </h1>
        <p className="text-base md:text-lg font-medium text-gray-700">
          Supporting SOL, ETH, BTC, and USDT! All prizes are combined into a massive global pool
        </p>
      </header>

      {/* NEW DEPOSIT SYSTEM SECTION */}
      <section className="py-8 px-4">
        <div className="max-w-4xl mx-auto bg-black text-white p-8 md:p-12 rounded-2xl shadow-retro-lg border-4 border-yellow-400 relative">
          <div className="grid md:grid-cols-2 gap-10 items-center">

            {/* Step 1: Exchange Rules & Address Request */}
            <div>
              <h2 className="text-3xl md:text-4xl font-black uppercase mb-4 text-yellow-400">Buy Tickets</h2>
              <div className="font-mono text-xl md:text-2xl font-bold bg-white text-black inline-block px-4 py-2 rounded border-2 border-black mb-4">
                $1 USD = 1 Ticket
              </div>
              <p className="text-sm font-bold text-gray-300 mb-6 border-l-4 border-yellow-400 pl-3">
                Send <span className="text-white">ANY</span> amount to your vault wallet. The deposit will be automatically converted into tickets based on the current live exchange rate!
              </p>

              {/* Currency Selector */}
              <div className="flex gap-2 mb-6">
                {['BTC', 'ETH', 'SOL', 'USDT'].map((c) => (
                  <button
                    key={c}
                    disabled={!!ephemeralAddress}
                    onClick={() => setCurrency(c as 'SOL' | 'ETH' | 'BTC' | 'USDT')}
                    className={`flex-1 py-2 font-bold rounded border-2 border-transparent ${currency === c ? 'bg-yellow-400 text-black border-black' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'} disabled:opacity-50`}
                  >
                    {c}
                  </button>
                ))}
              </div>

              <div className="bg-white/10 p-5 rounded-xl border border-gray-600 mb-6">
                <label className="block text-sm font-bold uppercase mb-2 text-gray-300">Your {currency} Payout Address</label>
                <input
                  type="text"
                  value={payoutAddress}
                  onChange={(e) => setPayoutAddress(e.target.value)}
                  placeholder="Where winnings go..."
                  disabled={!!ephemeralAddress}
                  className="w-full bg-white text-black p-3 rounded font-mono border-2 border-transparent outline-none mb-4"
                />
                {!ephemeralAddress ? (
                  <button
                    onClick={handleGenerateDeposit}
                    className="w-full bg-yellow-400 text-black font-black uppercase py-3 rounded hover:bg-yellow-300 transition-colors"
                  >
                    Generate Deposit Address
                  </button>
                ) : (
                  <div className="text-sm text-green-400 font-bold flex items-center justify-center gap-2 mt-2">
                    <CheckCircle2 className="w-5 h-5" /> Saved Payout Address
                  </div>
                )}
              </div>
            </div>

            {/* Step 2: Show Ephemeral Address */}
            <div className={`bg-white text-black p-6 md:p-8 rounded-xl border-4 ${ephemeralAddress ? 'border-yellow-400' : 'border-gray-500 opacity-50'} text-center relative flex flex-col justify-center transition-all min-h-[300px]`}>
              {!ephemeralAddress ? (
                <div className="flex flex-col items-center justify-center h-full">
                  <Anchor className="w-12 h-12 text-gray-400 mb-4" />
                  <p className="font-bold text-gray-500 uppercase">Enter payout address</p>
                </div>
              ) : sweepSuccess ? (
                <div className="flex flex-col items-center justify-center h-full animate-in fade-in zoom-in duration-500">
                  <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mb-4 border-4 border-green-500">
                    <CheckCircle2 className="w-8 h-8 text-green-600" />
                  </div>
                  <h3 className="text-2xl font-black uppercase mb-2">Deposit Secured!</h3>
                  <p className="font-mono text-xl font-bold bg-gray-100 p-2 rounded mb-2">+{ticketsEarned.toLocaleString(undefined, { maximumFractionDigits: 2 })} Tickets</p>
                </div>
              ) : (
                <div className="animate-in fade-in duration-500">
                  <p className="font-black uppercase mb-2 text-gray-500 text-sm tracking-widest flex items-center justify-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse"></span>
                    Waiting for {currency}...
                  </p>

                  <div className="bg-gray-100 p-4 rounded-lg mb-4 font-mono font-bold text-sm sm:text-base break-all border-2 border-black selection:bg-yellow-400">
                    {ephemeralAddress}
                  </div>

                  {currency === 'ETH' && (
                    <div className="mb-4 bg-yellow-100 text-yellow-800 p-2 rounded text-xs font-bold flex items-start gap-2 border border-yellow-300 text-left">
                      <Info className="w-4 h-4 shrink-0 mt-0.5" />
                      <span>ETH network gas fees apply. If your deposit is less than the current gas fee, it cannot be processed.</span>
                    </div>
                  )}

                  {currency === 'USDT' && (
                    <div className="mb-4 bg-green-100 text-green-800 p-2 rounded text-xs font-bold flex items-start gap-2 border border-green-300 text-left">
                      <Info className="w-4 h-4 shrink-0 mt-0.5" />
                      <span>Send only ERC-20 USDT on Ethereum mainnet. Do not send TRC-20 or other network variants — they will be lost.</span>
                    </div>
                  )}

                  <button
                    onClick={() => copyToClipboard(ephemeralAddress)}
                    className="w-full flex items-center justify-center gap-2 bg-yellow-400 text-black border-4 border-black font-black uppercase py-4 text-lg rounded-xl shadow-retro hover:shadow-retro-hover active:-translate-y-1 transition-all"
                  >
                    {copied ? <CheckCircle2 className="w-6 h-6" /> : <Copy className="w-6 h-6" />}
                    {copied ? 'Copied!' : 'Copy Address'}
                  </button>

                  {(isSweeping) && (
                    <div className="absolute inset-0 bg-white/90 backdrop-blur-sm z-10 flex flex-col items-center justify-center rounded-xl p-4">
                      <Loader2 className="w-12 h-12 animate-spin text-yellow-500 mb-4" />
                      <h3 className="font-black text-xl mb-2">Processing Deposit...</h3>
                      <p className="text-sm text-center text-gray-600 text-red-500 font-bold">Do not close this window!</p>
                    </div>
                  )}
                </div>
              )}
            </div>

          </div>

          {/* IN-BOX WARNING */}
          <div className="mt-6 bg-red-500/20 border-2 border-red-500 text-red-300 rounded-xl p-3 text-sm font-bold flex items-center gap-3">
            <AlertTriangle className="w-5 h-5 shrink-0 text-red-400" />
            <span>Do not close this window during a deposit. The private key exists only in your browser until swept!</span>
          </div>
        </div>
      </section>

      {/* CHECK TICKETS / LOGIN SECTION */}
      <section className="py-8 px-4">
        <div className="max-w-4xl mx-auto bg-white text-black p-8 md:p-12 rounded-2xl shadow-retro-lg border-4 border-black">
          <div className="text-center mb-8">
            <h2 className="text-3xl md:text-4xl font-black uppercase mb-4">Check Your Tickets</h2>
          </div>
          <div className="max-w-xl mx-auto">
            <div className="flex flex-col sm:flex-row gap-4 mb-6">
              <input
                type="text"
                value={loginAddress}
                onChange={(e) => { setLoginAddress(e.target.value); setUserTickets(null); setPoolPercentage(null); }}
                placeholder="Your Payout Address..."
                className="flex-1 bg-gray-100 text-black p-4 rounded-xl font-mono border-2 border-black focus:border-yellow-400 outline-none"
              />
              <button
                onClick={handleLogin}
                disabled={loadingLogin}
                className="bg-black text-white font-black uppercase px-8 py-4 rounded-xl flex items-center justify-center hover:bg-gray-800 shadow-retro-hover hover:-translate-y-1 active:translate-y-1"
              >
                {loadingLogin ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Check'}
              </button>
            </div>
            {userTickets !== null && poolPercentage !== null && (
              <div className="bg-yellow-100 border-4 border-black p-6 rounded-xl text-center">
                <div className="grid grid-cols-1 gap-4">
                  <div className="bg-white p-4 border-2 border-black rounded-lg">
                    <div className="text-sm font-bold text-gray-500 uppercase mb-1">Total Tickets</div>
                    <div className="text-3xl font-black">
                      {userTickets > 0 && userTickets < 0.0001 ? "0.0001" : userTickets.toLocaleString(undefined, { minimumFractionDigits: 4, maximumFractionDigits: 4 })}
                    </div>
                  </div>
                  <div className="bg-white p-4 border-2 border-black rounded-lg">
                    <div className="text-sm font-bold text-gray-500 uppercase mb-1">Win Probability</div>
                    <div className="text-3xl font-black text-green-600">
                      {poolPercentage > 0 && poolPercentage < 0.0001 ? "< 0.0001" : poolPercentage.toLocaleString(undefined, { minimumFractionDigits: 4, maximumFractionDigits: 4 })}%
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </section>

      <section className="py-12 px-4">
        <div className="max-w-4xl mx-auto bg-white border-4 border-black rounded-xl p-6 md:p-10 shadow-retro-lg">
          <div className="flex justify-between items-center mb-8 pb-4 border-b-2 border-black">
            <h2 className="text-2xl font-black uppercase flex items-center gap-3">
              <Anchor className="text-yellow-500" /> Multi-Chain Ledger
            </h2>
            <div className="flex gap-2 text-xs font-mono font-bold bg-green-100 text-green-800 px-3 py-1 rounded border-2 border-green-800 items-center">
              <span className="w-2 h-2 rounded-full bg-green-600 animate-pulse"></span>
              SYNCED
            </div>
          </div>

          <div className="space-y-4">
            {loading && transactions.length === 0 ? (
              <div className="text-center py-12 text-gray-500 font-bold animate-pulse">Scanning blockchains...</div>
            ) : transactions.length === 0 ? (
              <div className="text-center py-12 text-gray-500 font-bold">No recent transactions.</div>
            ) : transactions.map((log, i) => (
              <div key={i} className="flex justify-between items-center p-4 border-2 border-black rounded tracking-tight hover:bg-yellow-50 transition-colors">
                <div className="flex items-center gap-4">
                  <div className="p-2 rounded border-2 border-black bg-yellow-400">
                    <span className="font-black text-xs">{log.currency}</span>
                  </div>
                  <div>
                    <div className="font-bold text-sm md:text-base">Network Transfer</div>
                    <div className="text-xs text-gray-500 font-mono mt-1">Tx: {log.signature.slice(0, 12)}...</div>
                  </div>
                </div>
                <div className="text-right flex flex-col items-end">
                  <span className="text-xs text-black font-semibold uppercase">{log.time}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FOOTER / SOCIALS */}
      <footer className="py-8 text-center flex flex-col items-center">
        <h3 className="text-xl font-black uppercase tracking-widest text-gray-500 mb-6">Join the Community</h3>
        <div className="flex gap-6">
          {/* X (Twitter) */}
          <a href="#" className="p-3 bg-white border-2 border-black rounded-lg shadow-retro hover:-translate-y-1 hover:shadow-retro-hover transition-all text-black">
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
              <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
            </svg>
          </a>

          {/* Discord */}
          <a href="#" className="p-3 bg-white border-2 border-black rounded-lg shadow-retro hover:-translate-y-1 hover:shadow-retro-hover transition-all text-black">
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
              <path d="M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189Z" />
            </svg>
          </a>

          {/* TikTok */}
          <div className="relative group cursor-not-allowed">
            <div className="p-3 bg-gray-200 border-2 border-gray-400 rounded-lg text-gray-400 opacity-60 flex items-center justify-center">
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                <path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-5.2 1.74 2.89 2.89 0 012.31-4.64 2.93 2.93 0 01.88.13V9.4a6.84 6.84 0 00-1-.05A6.33 6.33 0 005 15.68a6.34 6.34 0 006.27 6.36A6.29 6.29 0 0017.62 16V9.29a8.4 8.4 0 004.38 1.24v-3.5a5.53 5.53 0 01-2.41-.34z" />
              </svg>
            </div>
            <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-yellow-400 text-black text-[10px] font-black uppercase px-2 py-0.5 rounded border-2 border-black shadow-retro whitespace-nowrap rotate-6 pointer-events-none group-hover:scale-110 transition-transform">
              Coming Soon!
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
