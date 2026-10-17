/**
 * Co-founders, shown on the About page and the landing page's team strip.
 * To add a photo, drop it in frontend/public/team and set `photo`; entries
 * without one render an initials tile.
 */

export const FOUNDERS = [
  {
    name: 'Palash Desarda',
    role: 'Co-founder',
    focus: 'Consulting & fintech',
    bio: 'Palash runs consulting and fintech at AscendDV, connecting what organizations need with what the product delivers.',
    photo: '/team/palash.jpg',
  },
  {
    name: 'Aaryaman Chopra',
    role: 'Co-founder',
    focus: 'Software & technology',
    bio: 'Aaryaman built AscendDV end to end: all of the software development and the technology behind it.',
    photo: '/team/aaryaman.jpg',
  },
  {
    name: 'Kaiyaan Faisal',
    role: 'Co-founder',
    focus: 'Technology & finance',
    bio: 'Kaiyaan co-built much of our technology and is our go-to for finance, the team’s financial wizard.',
    photo: '/team/kaiyaan.jpg',
  },
  {
    name: 'Ethan De Guzman',
    role: 'Co-founder',
    focus: 'Outreach & finance',
    bio: 'Ethan leads outreach, bringing AscendDV to the organizations it can help, and works on finance.',
    photo: '/team/ethan.jpg',
  },
];

export function initials(name) {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('');
}
