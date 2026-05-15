import React, { useState, useEffect } from 'react';
import { Trophy, RefreshCw, AlertTriangle, ShieldCheck, Trash2 } from 'lucide-react';

interface TicketEntry {
  payoutAddress: string;
  depositAddress: string;
  amount: number;
  currency: string;
  usdValue: number;
  tickets: number;
  timestamp: string;
  txHash?: string;
}

export default function Admin() {
  const [entries, setEntries] = useState<TicketEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [drawing, setDrawing] = useState(false);
  const [winner, setWinner] = useState<TicketEntry | null>(null);
  const [totalTickets, setTotalTickets] = useState(0);

  const fetchEntries = async () => {
    setLoading(true);
    try {
      const { collection, getDocs } = await import('firebase/firestore');
      const { db } = await import('../lib/firebase');
      
      const snapshot = await getDocs(collection(db, 'entries'));
      const data: TicketEntry[] = snapshot.docs.map(doc => {
        const d = doc.data() as TicketEntry;
        // Store doc id to allow clearing
        return { ...d, _id: doc.id };
      });
      // Sort manually to avoid needing a Firestore composite index
      data.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
      setEntries(data);
    } catch (e: any) {
      console.error("Admin Fetch Error:", e);
      alert(`Error loading tickets: ${e?.message || e}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchEntries();
  }, []);

  const handleDraw = () => {
    if (!window.confirm("Are you sure you want to trigger the draw? This will pick a winner!")) return;
    setDrawing(true);
    try {
      if (entries.length === 0) {
        alert("No entries");
        return;
      }

      let totalTix = 0;
      entries.forEach(e => totalTix += e.tickets);

      let random = Math.random() * totalTix;
      let selectedWinner = entries[0];
      for (const entry of entries) {
        random -= entry.tickets;
        if (random <= 0) {
          selectedWinner = entry;
          break;
        }
      }

      setWinner(selectedWinner);
      setTotalTickets(totalTix);
    } catch (e) {
      console.error(e);
      alert("Error generating draw.");
    } finally {
      setDrawing(false);
    }
  };

  const clearEntries = async () => {
    if (!window.confirm("WARNING: This will permanently delete all ticket entries. Cannot be undone. Are you sure?")) return;
    if (!window.confirm("FINAL CONFIRMATION: Double check before deleting the entire database. Proceed?")) return;
    try {
      const { doc, deleteDoc } = await import('firebase/firestore');
      const { db } = await import('../lib/firebase');
      
      for (const entry of entries) {
        if ((entry as any)._id) {
          await deleteDoc(doc(db, 'entries', (entry as any)._id));
        }
      }
      
      setEntries([]);
      setWinner(null);
    } catch (e) {
      console.error(e);
      alert("Error clearing entries");
    }
  };

  return (
    <div className="min-h-screen bg-[#faf9f6] text-[#0f172a] font-mono p-8">
      <header className="flex justify-between items-center mb-8 border-b-4 border-black pb-4">
        <h1 className="text-3xl font-black uppercase flex items-center gap-3">
          <ShieldCheck className="w-8 h-8 text-black" />
          Internal Draw Admin
        </h1>
        <div className="flex gap-4">
          <button 
            onClick={fetchEntries}
            className="flex items-center gap-2 bg-white border-2 border-black px-4 py-2 font-bold hover:bg-gray-100 transition-colors"
          >
            <RefreshCw className="w-4 h-4" /> Refresh
          </button>
          <button 
            onClick={clearEntries}
            className="flex items-center gap-2 bg-red-500 text-white border-2 border-black px-4 py-2 font-bold hover:bg-red-600 transition-colors"
          >
            <Trash2 className="w-4 h-4" /> Clear DB
          </button>
        </div>
      </header>

      <div className="grid md:grid-cols-2 gap-8">
        {/* ENTRIES PANEL */}
        <div className="bg-white border-4 border-black p-6 shadow-retro">
          <h2 className="text-xl font-black uppercase mb-4 flex justify-between items-center">
            Registered Tickets
            <span className="bg-black text-white px-3 py-1 text-sm rounded">Total: {entries.reduce((a, b) => a + Number(b.tickets), 0).toFixed(2)}</span>
          </h2>
          
          <div className="bg-gray-100 border-2 border-black h-96 overflow-y-auto p-4 space-y-3">
            {loading ? (
              <p className="text-gray-500 animate-pulse">Loading database...</p>
            ) : entries.length === 0 ? (
              <p className="text-gray-500">No tickets found in database.</p>
            ) : (
              entries.map((req, i) => (
                <div key={i} className="bg-white border-2 border-black p-3 text-sm flex flex-col gap-2">
                  <div className="flex justify-between font-bold border-b border-gray-200 pb-2">
                    <span className="text-blue-600 truncate mr-4">Payout: {req.payoutAddress.slice(0,12)}...</span>
                    <span>+{Number(req.tickets).toFixed(2)} TIX</span>
                  </div>
                  <div className="grid grid-cols-2 text-xs text-gray-600 gap-1">
                    <p>{req.currency || 'SOL'}: {Number(req.amount || (req as any).amountSol || 0).toFixed(4)}</p>
                    <p>Time: {new Date(req.timestamp).toLocaleTimeString()}</p>
                    <p className="col-span-2 truncate text-gray-400">Vault Tx: {req.txHash}</p>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* DRAW PANEL */}
        <div className="bg-yellow-400 border-4 border-black p-6 shadow-retro flex flex-col items-center text-center">
          <Trophy className="w-16 h-16 mb-4" />
          <h2 className="text-3xl font-black uppercase mb-2">Execute Draw</h2>
          <p className="text-sm font-bold mb-8">Selects one winner weighted by ticket volume.</p>
          
          <button 
            onClick={handleDraw}
            disabled={drawing || entries.length === 0}
            className="w-full bg-black text-white text-2xl font-black uppercase py-6 border-4 border-black shadow-retro-hover hover:-translate-y-1 transition-transform disabled:opacity-50 disabled:hover:translate-y-0 relative overflow-hidden"
          >
            {drawing ? 'Calculating...' : 'Pick Winner'}
          </button>

          {winner && (
            <div className="mt-8 w-full bg-white border-4 border-black p-6 text-left animate-in fade-in slide-in-from-bottom-4">
              <h3 className="text-xl font-black uppercase text-green-600 flex items-center gap-2 mb-4 border-b-2 border-black pb-2">
                <Trophy className="w-6 h-6" /> Winner Selected
              </h3>
              <div className="space-y-4">
                <div>
                  <p className="text-xs font-bold text-gray-500 uppercase">Send Prize To:</p>
                  <p className="font-bold text-lg bg-gray-100 p-2 border-2 border-black break-all select-all">{winner.payoutAddress}</p>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-xs font-bold text-gray-500 uppercase">Winning Ticket Contributed:</p>
                    <p className="font-bold">{winner.usdValue ? `$${winner.usdValue.toFixed(2)}` : `${Number((winner as any).amountSol || winner.amount).toFixed(4)} SOL`}</p>
                  </div>
                  <div>
                    <p className="text-xs font-bold text-gray-500 uppercase">Their Total Tickets:</p>
                    <p className="font-bold">{Number(winner.tickets).toFixed(2)} / {Number(totalTickets).toFixed(2)}</p>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
