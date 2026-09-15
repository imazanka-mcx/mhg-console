import type { Config } from 'tailwindcss';

/* ---------------------------------------------------------------------------
   Corporate Console — Signal tokens, inherited from Inspire (its docs/23).

   Same house, same rule: the chrome is achromatic, and color is spent only
   where it carries meaning. Anything colored is worth looking at.

   Two deliberate differences from Inspire's copy:
     - `room` is absent. Room status is the PMS's highest-frequency color
       surface and means nothing above property (docs/01 §1.1).
     - `status` is added. The registry's own vocabulary — a code is pipeline,
       active or retired — and those are the states this app exists to show.
--------------------------------------------------------------------------- */

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        /* neutral: graphite. Overrides Tailwind's slate on purpose — same
           lightness relationships, blue bias removed. */
        slate: {
          50: '#f8f9fa',
          100: '#f4f5f6',
          200: '#e1e3e6',
          300: '#c9cdd3',
          400: '#969ca6',
          500: '#6f7681',
          600: '#5f6672',
          700: '#454b55',
          800: '#2a2e36',
          900: '#15181c',
          950: '#0d0f12',
        },

        /* application chrome — furniture, not accent */
        nav: {
          DEFAULT: '#1a1d21',
          hover: '#23272d',
          rule: '#31363e',
          ink: '#ffffff',
          dim: '#a9afba',
          accent: '#7fa8ff',
        },

        /* interactive only: links, primary buttons, focus */
        brand: {
          50: '#eef2fe',
          100: '#dce4fd',
          200: '#bbcbfb',
          300: '#90a9f5',
          400: '#5d80ee',
          500: '#3866e9',
          600: '#2b5ce6',
          700: '#1f45b8',
          800: '#1a3891',
          900: '#172e72',
        },

        /* state — never decoration */
        success: {
          50: '#ecf7f2',
          100: '#d2ece1',
          200: '#a9dac7',
          300: '#74c2a6',
          400: '#34a382',
          500: '#0e8a68',
          600: '#08795a',
          700: '#06654b',
          800: '#06503c',
          900: '#053f30',
        },
        warning: {
          50: '#fdf6e7',
          100: '#f9eac6',
          200: '#f0d28d',
          300: '#e3b554',
          400: '#cf9722',
          500: '#ae7a05',
          600: '#8a5f00',
          700: '#744f00',
          800: '#5d3f00',
          900: '#4a3200',
        },
        danger: {
          50: '#fdf0ef',
          100: '#fadcd9',
          200: '#f4bab5',
          300: '#ea8e86',
          400: '#dc5a50',
          500: '#cc3a30',
          600: '#be2f26',
          700: '#a0241d',
          800: '#7f1d17',
          900: '#661813',
        },
        accent: {
          50: '#f3effb',
          100: '#e7def7',
          200: '#cfbeef',
          300: '#b098e3',
          400: '#8d6ed4',
          500: '#7856cb',
          600: '#6d4ac4',
          700: '#57399e',
          800: '#452e7d',
          900: '#372563',
        },

        /* registry lifecycle. Separated by weight, not hue: active is the one
           saturated state because it is the one that means a hotel is open.
           Retired is quiet on purpose — it is still claimed (G3), but it is
           history, and history should not compete with the live portfolio. */
        status: {
          pipeline: '#ae7a05',
          active: '#08795a',
          retired: '#6f7681',
        },
      },
      fontFamily: {
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
    },
  },
  plugins: [],
};

export default config;
