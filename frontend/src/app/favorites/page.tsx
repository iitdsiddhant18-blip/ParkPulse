'use client';

import React, { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { Heart, MapPin, ArrowRight } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { apiGetFavorites, apiRemoveFavorite } from '@/lib/api';
import { FavoriteLot } from '@/lib/types';

export default function FavoritesPage() {
  const { user, token } = useAuth();
  const [favorites, setFavorites] = useState<FavoriteLot[]>([]);

  const loadFavorites = useCallback(async () => {
    if (!token) return;
    try {
      const res = await apiGetFavorites(token);
      setFavorites(res.favorites);
    } catch {
      // Ignore
    }
  }, [token]);

  useEffect(() => {
    loadFavorites();
  }, [loadFavorites]);

  const handleRemove = async (lotId: number) => {
    if (!token) return;
    await apiRemoveFavorite(token, lotId);
    await loadFavorites();
  };

  return (
    <div data-testid="favorites-page" className="space-y-8">
      <div className="border-b border-editorial-border pb-6">
        <div className="text-xs font-bold uppercase tracking-wider text-editorial-muted">
          Saved Hubs · Many-to-Many Junction (favorite_lots)
        </div>
        <h1 className="mt-1 text-3xl font-extrabold tracking-tight text-editorial-ink">
          Favorite Parking Lots
        </h1>
      </div>

      {!user ? (
        <div className="border border-editorial-ink bg-editorial-surface p-10 text-center">
          <p className="text-sm font-semibold text-editorial-ink">
            Sign in to view your favorite lots.
          </p>
          <Link
            href="/login"
            className="mt-3 inline-block bg-editorial-vermilion px-4 py-2 text-xs font-bold uppercase text-white"
          >
            Sign In
          </Link>
        </div>
      ) : favorites.length === 0 ? (
        <div className="border border-editorial-border bg-editorial-surface p-10 text-center">
          <p className="text-sm font-bold text-editorial-ink">No favorite lots saved yet.</p>
          <Link
            href="/"
            className="mt-3 inline-block bg-editorial-ink px-4 py-2 text-xs font-bold uppercase text-editorial-bg"
          >
            Explore Parking Lots
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
          {favorites.map((fav) => (
            <div
              key={fav.lot_id}
              className="flex flex-col justify-between border border-editorial-border bg-editorial-surface p-6"
            >
              <div>
                <div className="flex items-start justify-between">
                  <h2 className="font-serif text-xl font-bold text-editorial-ink">{fav.name}</h2>
                  <button
                    type="button"
                    onClick={() => handleRemove(fav.lot_id)}
                    className="border border-editorial-vermilion bg-editorial-vermilion/10 p-1.5 text-editorial-vermilion"
                    title="Remove favorite"
                  >
                    <Heart className="h-4 w-4 fill-editorial-vermilion" />
                  </button>
                </div>
                <p className="mt-1 flex items-center gap-1 text-xs text-editorial-muted">
                  <MapPin className="h-3.5 w-3.5 text-editorial-vermilion" />
                  <span>
                    {fav.address}, {fav.city}
                  </span>
                </p>
                <div className="mt-4 border-t border-editorial-border pt-3 font-mono text-xs font-bold text-editorial-cobalt">
                  {fav.available_slots} / {fav.total_slots} Slots Free (
                  {Number(fav.occupancy_pct).toFixed(0)}% Occupied)
                </div>
              </div>

              <div className="mt-5 flex justify-end border-t border-editorial-border pt-3">
                <Link
                  href={`/lots/${fav.lot_id}`}
                  className="inline-flex items-center gap-1 bg-editorial-ink px-4 py-2 text-xs font-bold uppercase text-editorial-bg hover:bg-editorial-vermilion"
                >
                  <span>Book Slot</span>
                  <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
