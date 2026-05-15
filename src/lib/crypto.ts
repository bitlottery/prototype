import { Connection, PublicKey, LAMPORTS_PER_SOL, Keypair, SystemProgram, Transaction } from '@solana/web3.js';
import { ethers } from 'ethers';
import * as ecc from 'tiny-secp256k1';
import { ECPairFactory } from 'ecpair';
import * as bitcoin from 'bitcoinjs-lib';

export const MAIN_WALLETS = {
  SOL: '8zx8hWKKSzrUA4kgxBrGJknAuUheoWTEcSAWmpFLUi85',
  ETH: '0x6967C36f7e77192c5FcD6f2822c9454cdD2A6CE6',
  BTC: 'bc1qmjvqynknn9hq622e7tph8unfxwmmhunze9rrgp',
};

// ============================================
// SOLANA
// ============================================
const solConnection = new Connection('https://solana-rpc.publicnode.com', 'confirmed');

export function generateSolWallet() {
  const kp = Keypair.generate();
  return {
    keypair: kp,
    address: kp.publicKey.toBase58(),
  };
}

export async function sweepSol(kp: Keypair) {
  const balance = await solConnection.getBalance(kp.publicKey, 'confirmed');
  const feeLamports = 5000;
  const sweepAmount = balance - feeLamports;
  
  if (sweepAmount <= 0) throw new Error("Balance too small to cover fee");

  const latestBlockhash = await solConnection.getLatestBlockhash('confirmed');
  const transaction = new Transaction({
    feePayer: kp.publicKey,
    recentBlockhash: latestBlockhash.blockhash,
  }).add(
    SystemProgram.transfer({
      fromPubkey: kp.publicKey,
      toPubkey: new PublicKey(MAIN_WALLETS.SOL),
      lamports: sweepAmount,
    })
  );

  const signature = await solConnection.sendTransaction(transaction, [kp]);
  return { txHash: signature, sweepAmount, balance };
}

export async function getSolBalance() {
  const bal = await solConnection.getBalance(new PublicKey(MAIN_WALLETS.SOL));
  return bal / LAMPORTS_PER_SOL;
}

// ============================================
// ETHEREUM
// ============================================
const ethProvider = new ethers.JsonRpcProvider('https://cloudflare-eth.com');

export function generateEthWallet() {
  const wallet = ethers.Wallet.createRandom();
  return {
    wallet,
    address: wallet.address,
  };
}

export async function sweepEth(wallet: ethers.Wallet) {
  const connectedWallet = wallet.connect(ethProvider);
  const balance = await ethProvider.getBalance(connectedWallet.address);
  
  if (balance === 0n) throw new Error("Zero balance");

  const feeData = await ethProvider.getFeeData();
  const gasLimit = 21000n;
  const maxFeePerGas = feeData.maxFeePerGas || feeData.gasPrice || BigInt(50 * 1e9); // 50 gwei fallback
  const gasCost = gasLimit * maxFeePerGas;

  if (balance <= gasCost) throw new Error(`Balance too small to cover gas fee (${ethers.formatEther(gasCost)} ETH)`);

  const amountToSend = balance - gasCost;

  const tx = await connectedWallet.sendTransaction({
    to: MAIN_WALLETS.ETH,
    value: amountToSend,
  });

  return { txHash: tx.hash, sweepAmount: parseFloat(ethers.formatEther(amountToSend)), balance: parseFloat(ethers.formatEther(balance)) };
}

export async function getEthBalance() {
  try {
    const bal = await ethProvider.getBalance(MAIN_WALLETS.ETH);
    return parseFloat(ethers.formatEther(bal));
  } catch (e) {
    console.error(e);
    return 0;
  }
}

// ============================================
// BITCOIN
// ============================================
const ECPair = ECPairFactory(ecc);

export function generateBtcWallet() {
  const keyPair = ECPair.makeRandom();
  const { address } = bitcoin.payments.p2wpkh({ pubkey: keyPair.publicKey });
  return {
    keyPair,
    address: address!,
  };
}

export async function sweepBtc(keyPair: any) {
  const { address } = bitcoin.payments.p2wpkh({ pubkey: keyPair.publicKey });
  
  // Fetch UTXOs
  const utxosRes = await fetch(`https://mempool.space/api/address/${address}/utxo`);
  const utxos = await utxosRes.json();
  if (utxos.length === 0) throw new Error("No UTXOs found");

  // Fetch fees
  const feesRes = await fetch('https://mempool.space/api/v1/fees/recommended');
  const fees = await feesRes.json();
  const feeRate = fees.fastestFee; // sats/vbyte

  const psbt = new bitcoin.Psbt({ network: bitcoin.networks.bitcoin });
  let balance = 0;
  
  for (const utxo of utxos) {
    balance += utxo.value;
    const txRes = await fetch(`https://mempool.space/api/tx/${utxo.txid}/hex`);
    const txHex = await txRes.text();
    psbt.addInput({
      hash: utxo.txid,
      index: utxo.vout,
      // We must provide witnessUtxo for segwit
      witnessUtxo: {
        script: bitcoin.payments.p2wpkh({ pubkey: keyPair.publicKey }).output!,
        value: utxo.value
      }
    });
  }

  // Calculate estimated fee: (inputs * 68) + (outputs * 31) + 10
  const estimatedVBytes = (utxos.length * 68) + (1 * 31) + 10;
  const fee = estimatedVBytes * feeRate;

  if (balance <= fee) throw new Error("Balance too small to cover network fees");

  psbt.addOutput({
    address: MAIN_WALLETS.BTC,
    value: balance - fee,
  });

  psbt.signAllInputs(keyPair);
  psbt.finalizeAllInputs();
  const txHex = psbt.extractTransaction().toHex();

  // Broadcast
  const broadcastRes = await fetch('https://mempool.space/api/tx', {
    method: 'POST',
    body: txHex
  });
  
  if (!broadcastRes.ok) {
    const errText = await broadcastRes.text();
    throw new Error(`Broadcast failed: ${errText}`);
  }
  
  return { 
    txHash: psbt.extractTransaction().getId(), 
    sweepAmount: (balance - fee) / 1e8,
    balance: balance / 1e8
  };
}

export async function getBtcBalance() {
  try {
    const res = await fetch(`https://mempool.space/api/address/${MAIN_WALLETS.BTC}`);
    const data = await res.json();
    const sats = data.chain_stats.funded_txo_sum - data.chain_stats.spent_txo_sum;
    return sats / 1e8;
  } catch (e) {
    console.error(e);
    return 0;
  }
}
