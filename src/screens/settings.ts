// Settings.

import { register, show } from '../app';
import { configured, currentUser, email, isGuest } from '../net/supabase';
import { playerName } from '../account';
import { $, on } from '../ui/dom';
import { save, settings } from '../store';
import { feel } from '../ui/feel';

function renderSettings() {
  $('player-name').textContent = playerName();
  $('player-kind').textContent = !configured ? 'Playing offline'
    : !currentUser() ? 'Not connected to the game server'
      : isGuest() ? 'Guest account · tap to sign in with Google' : `Google${email() ? ` · ${email()}` : ''}`;
  $<HTMLInputElement>('set-left').checked = settings().showLeft;
  $<HTMLInputElement>('set-sound').checked = settings().sound;
  $<HTMLInputElement>('set-vibrate').checked = settings().vibrate;
}

const toggle = (id: string, key: 'showLeft' | 'sound' | 'vibrate') =>
  on(id, 'change', (e) => {
    settings()[key] = (e.target as HTMLInputElement).checked;
    save();
    if (key === 'sound' && settings().sound) feel.key();
    if (key === 'vibrate' && settings().vibrate) navigator.vibrate?.(30);
  });
toggle('set-left', 'showLeft');
on('settings-account', 'click', () => show('account'));
toggle('set-sound', 'sound');
toggle('set-vibrate', 'vibrate');

register('settings', renderSettings);
