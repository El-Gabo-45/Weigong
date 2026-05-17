// ═══════════════════════════════════════════════════════
//  Piece Style Selector — startup popup
//  Lets the player choose between kanji labels or
//  universal SVG illustrations on piece centres.
//  Preference is stored in localStorage under 'pieceStyle'.
// ═══════════════════════════════════════════════════════

export const PIECE_STYLES = {
  KANJI:     'kanji',
  UNIVERSAL: 'universal',
};

const STORAGE_KEY = 'pieceStyle';

// ── SVG paths for every piece type ───────────────────────
// Each returns an inline SVG string sized to fit a ~26 px circle.
// Colors are set via CSS variables so they adapt to white/black pieces.
const SVG = {
  king: `<svg version="1.1" xmlns="http://www.w3.org/2000/svg" viewBox="-64 -64 640 640" preserveAspectRatio="xMidYMid meet">
    <path fill="currentColor" d="M405.995 477.15h-300v-60h300v60zm-10.3-107.13h-279.4a96.88 96.88 0 0 1 6.65 31.12h266.1a96.88 96.88 0 0 1 6.65-31.12zm-139.7-241.06a35.76 35.76 0 0 0-35.76 35.76c0 50.16 35.76 99.34 35.76 99.34s35.76-49.18 35.76-99.34a35.76 35.76 0 0 0-35.76-35.76zm8-15.38V94.24h18.36v-16h-18.36V54.85h-16v23.39h-18.36v16h18.36v19.38a51.9 51.9 0 0 1 16-.04zm81.64 51.36a98.74 98.74 0 0 0-38.13 7.61c-3.23 51.75-37.07 98.85-38.58 100.93l-4.93 6.76V354h140c16.57-26.15 40.78-42.41 40.78-90a99.13 99.13 0 0 0-99.14-99.07zm-141.16 7.61a99.16 99.16 0 0 0-137.25 91.51c0 47.55 24.21 63.82 40.78 90h139.99v-73.82l-4.94-6.79c-1.51-2.05-35.34-49.15-38.58-100.9z"/>
  </svg>`,

  queen: `<svg version="1.1" xmlns="http://www.w3.org/2000/svg" viewBox="-64 -64 640 640" preserveAspectRatio="xMidYMid meet">
    <path fill="currentColor" d="M477.518 181.966a25 25 0 0 1-34.91 23l-62.29 150.26h-248.92l-62.24-150.19a25 25 0 1 1 9.73-7.29l87 71.2 20.92-126.4a25 25 0 1 1 14.7-1.85l54.31 117 54.42-117.3a25 25 0 1 1 14.58 2.08l20.93 126.42 87.26-71.3a25 25 0 1 1 44.51-15.63zm-71.66 241.25h-300v60h300v-60zm-27.75-52h-244.22v36h244.22v-36z"/>
  </svg>`,

  general: `<svg version="1.1" xmlns="http://www.w3.org/2000/svg" viewBox="-64 -64 640 640" preserveAspectRatio="xMidYMid meet">
    <style type="text/css">
      .st0{fill:currentColor;}
    </style>
    <g>
      <path class="st0" d="M120 430 L392 430 L418 480 L94 480 Z" />
      <path class="st0" d="M150 390 C150 350 175 325 210 310 L302 310 C337 325 362 350 362 390 Z" />
      <path class="st0" d="M170 285 C170 215 205 165 256 165 C307 165 342 215 342 285 L312 330 L200 330 Z" />
      <path class="st0" d="M135 270 C145 230 175 205 210 205 L205 255 L170 300 Z" />
      <path class="st0" d="M377 270 C367 230 337 205 302 205 L307 255 L342 300 Z" />
      <path class="st0" d="M196 145 C196 92 223 60 256 60 C289 60 316 92 316 145 C316 182 289 205 256 205 C223 205 196 182 196 145 Z" />
      <path class="st0" d="M240 48 L272 48 L286 88 L256 108 L226 88 Z" />
      <path class="st0" d="M256 215 L278 255 L324 262 L290 292 L298 338 L256 315 L214 338 L222 292 L188 262 L234 255 Z" />
      <path class="st0" d="M108 180 L145 205 L145 340 L108 365 Z" />
      <path class="st0" d="M404 180 L367 205 L367 340 L404 365 Z" />
      <ellipse style="fill:currentColor;stroke-width:0.99968" cx="256.61761" cy="33.351025" rx="14.513872" ry="17.293123" />
    </g>
  </svg>`,

  elephant: `<svg version="1.1" xmlns="http://www.w3.org/2000/svg" viewBox="336 -148 1260 1456" preserveAspectRatio="xMidYMid meet">
    <path transform="translate(0,0)" fill="currentColor" d="M 660.337 68.8341 C 673.586 70.1255 696.786 98.756 703.807 109.375 C 728.395 146.566 724.415 188.074 702.345 225.211 C 686.29 253.169 666.102 273.71 658.215 305.908 C 649.697 340.687 680.547 374.719 715.187 364.214 C 749.19 353.902 774.586 309.601 792.228 280.524 C 822.395 230.611 849.607 178.819 898.679 144.432 C 950.508 108.113 1004.09 107.309 1063.93 118.147 C 1045.64 131.781 1033.06 144.169 1023.09 165.277 C 1019.77 172.308 1011.43 193.227 1014.07 200.416 C 1017.86 200.141 1022.53 191.717 1024.57 188.488 C 1040.36 163.493 1063.59 140.71 1090.68 128.129 C 1122.24 113.331 1158.42 111.841 1191.09 123.995 C 1221.96 135.733 1246.97 159.157 1260.7 189.197 C 1312.42 302.6 1188.82 438.037 1092.24 482.159 C 1090.73 481.067 1089.26 479.919 1087.84 478.716 C 1048.08 444.786 1042.08 386.686 1046.31 338.748 C 1046.39 337.795 1045.78 337.689 1045.01 337.051 C 1042.01 338.584 1041.32 341.077 1039.82 343.908 C 1011.93 396.417 1036.75 480.237 1092.42 506.181 C 1137.16 489.041 1200.44 437.543 1231.83 399.132 C 1249.44 377.525 1264.34 353.848 1276.2 328.627 C 1279.45 320.753 1282.56 310.205 1285.76 301.697 C 1302.63 334.32 1313.69 374.192 1318.02 410.524 C 1323.43 457.235 1320.16 504.544 1308.37 550.065 C 1287.28 634.235 1249.11 686.406 1280.25 774.927 L 1027.5 774.902 C 970.005 774.879 911.064 775.53 853.664 774.612 C 853.664 774.612 850.63 672.95 915.705 617.77 C 962.922 537.084 976.487 513.903 970.503 468.586 C 929.42 463.811 910.085 471.055 876.696 495.9 C 870.936 500.187 855.851 510.287 850.668 501.188 C 850.004 496.538 851.69 492.312 853.063 487.808 C 833.489 501.142 816.681 513.146 795.392 523.711 C 734.922 554.478 664.663 559.802 600.247 538.498 C 587.984 534.327 562.326 523.904 557.683 512.204 C 549.315 491.121 592.376 496.885 601.463 496.797 C 634.759 496.475 668.964 492.707 699.678 480.006 C 563.512 451.915 527.656 320.793 620.717 221.94 C 656.987 183.413 676.412 149.379 627.726 113.404 C 619.201 107.105 630.473 96.497 635.492 91.7511 C 643.484 84.1934 651.64 76.0017 660.337 68.8341 z M 614.618 513.232 L 582.921 513.418 C 588.171 515.891 593.446 518.542 598.948 520.358 C 619.5 527.94 641.003 532.635 662.845 534.31 C 738.787 540.169 803.207 508.057 859.3 459.936 C 851.907 437.47 839.166 427.878 815.223 428.527 C 804.646 435.616 790.129 449.461 778.045 457.986 C 726.514 494.339 677.113 509.734 614.618 513.232 z M 871.818 290.336 C 884.501 296.006 889.589 298.135 904.019 297.497 C 920.554 295.073 929.607 288.222 939.622 274.871 C 940.016 274.348 940.399 273.817 940.773 273.28 C 928.763 266.919 922.69 264.505 908.955 264.303 C 889.937 268.437 882.613 274.675 871.818 290.336 z"/>
    <path transform="translate(0,0)" fill="currentColor" fill-opacity="0.027451" d="M 582.921 513.418 L 614.618 513.232 C 605.631 516.218 602.965 514.167 598.948 520.358 C 593.446 518.542 588.171 515.891 582.921 513.418 z"/>
    <path transform="translate(0,0)" fill="currentColor" d="M 851.584 856.426 L 1284.03 856.693 C 1287.84 893.314 1304.53 925.829 1334.58 948.329 C 1342.54 954.253 1353.27 957.457 1358.63 966.312 C 1367.04 980.201 1358.84 992.33 1346.41 999.723 C 1327.77 1000.73 1302.62 999.95 1283.5 999.924 L 955.431 999.988 L 850.577 1000.04 C 831.17 1000.06 807.74 1000.66 788.73 999.688 C 779.05 994.037 770.602 983.715 774.552 971.957 C 778.636 959.33 794.061 953.024 803.777 945.745 C 827.026 928.325 843.417 901.715 848.414 873.121 C 849.191 868.675 849.835 860.18 851.584 856.426 z"/>
    <path transform="translate(0,0)" fill="currentColor" d="M 789.322 1017.28 C 806.293 1016.13 838.45 1017.19 856.317 1017.21 L 990.422 1017.3 L 1219.08 1017.24 C 1258.72 1017.22 1298.42 1017.14 1338.05 1017.27 C 1343.4 1017.59 1349.47 1017.03 1354.38 1019.32 C 1372.74 1027.88 1381.8 1049.26 1370.29 1067.17 C 1363.64 1077.52 1358.22 1080.15 1346.24 1083.3 C 1311.45 1084.04 1274.56 1083.43 1239.56 1083.45 L 1027.33 1083.44 L 875.737 1083.46 C 848.703 1083.48 821.454 1083.66 794.42 1083.34 C 788.764 1083.05 783.817 1083.05 778.803 1080.21 C 762.157 1070.8 754.129 1051.52 764.664 1034.37 C 771.257 1023.64 777.743 1020.61 789.322 1017.28 z"/>
    <path transform="translate(0,0)" fill="currentColor" d="M 840.395 792.404 C 866.225 791.722 894.912 792.358 920.928 792.387 L 1064.24 792.332 L 1209.44 792.219 C 1235.4 792.202 1261.35 792.112 1287.31 792.352 C 1298.78 792.459 1308.47 796.01 1313.31 807.351 C 1315.62 812.656 1315.66 818.678 1313.41 824.012 C 1309.97 832.042 1302.28 836.099 1294.6 839.131 C 1189.59 837.885 1081.65 839.129 976.446 839.137 L 893.548 839.164 C 877.865 839.209 862.17 839.401 846.489 839.158 C 830.897 838.917 824.352 830.793 819.613 816.964 C 823.513 803.464 825.803 796.848 840.395 792.404 z"/>
  </svg>`,

  priest: `<svg id="emoji" viewBox="-4 -4 80 80" version="1.1" xmlns="http://www.w3.org/2000/svg">
      <g id="line-supplement" transform="matrix(.8974 0 0 .8974 3.693 6.164)" fill="currentColor">
        <polygon stroke="currentColor" points="53.53 60.1 16.93 60.1 27.58 48.16 30.8 35.36 41.15 37.08 44.99 48.08"/>
        <rect x="20.66" y="29.34" width="32.26" height="3.726" stroke="currentColor"/>
        <path stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="m30.8 35.65v-2.434l10.49 0.1249-0.04286 3.56 0.0517 8.549-9.288-4.328z"/>
        <ellipse cx="36" cy="4.5" rx="2.5" ry="2.5"/>
        <path transform="matrix(1.114 0 0 1.114 -4.115 -6.869)" d="m36 12.45c-4.957-1.38e-4 -8.975 4.018-8.975 8.975 9.4e-4 4.956 4.019 8.973 8.975 8.973 4.956 1.37e-4 8.974-4.017 8.975-8.973 1.4e-4 -4.957-4.018-8.975-8.975-8.975zm0 2.646c0.5523 0 1 0.4477 1 1v4.328h4.328c0.5523 0 1 0.4477 1 1s-0.4477 1-1 1h-4.328v4.328c0 0.5523-0.4477 1-1 1-0.5523 0-1-0.4477-1-1v-4.328h-4.328c-0.5523 0-1-0.4477-1-1s0.4477-1 1-1h4.328v-4.328c0-0.5523 0.4477-1 1-1zm-1 7.328h2z"/>
      </g>
      <g id="line" transform="matrix(.8974 0 0 .8974 3.693 6.164)" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2.229">
        <circle cx="36" cy="17" r="10"/>
        <path d="m21.53 29.34a2.019 2.019 0 0 0 0 4"/>
        <path d="m30.8 35.65c0 10.97-11.86 23.57-13.87 24.45h19.07"/>
        <path d="m41.25 36.9c0.8326 10.65 11.88 22.36 13.82 23.2h-19.07"/>
        <path d="m52.05 33.34a2.019 2.019 0 0 0 0-4"/>
        <line x1="21.53" x2="52.05" y1="29.34" y2="29.34"/>
        <line x1="21.53" x2="52.05" y1="33.34" y2="33.34"/>
        <ellipse cx="36" cy="4.5" rx="2.5" ry="2.5" fill="currentColor"/>
      </g>
    </svg>`,

  horse: `<svg version="1.1" xmlns="http://www.w3.org/2000/svg" viewBox="-64 -64 640 640" preserveAspectRatio="xMidYMid meet">
    <style type="text/css">
      .st0{fill:currentColor;}
    </style>
    <g>
      <rect x="152.454" y="446.586" class="st0" width="281.238" height="65.414"/>
      <path class="st0" d="M209.138,277.882L171.242,417.06h241.336c0,0,8.442-121.141,19.004-243.569
        c6.908-80.147-61.224-160.438-157.07-149.051c-6.084,0.721-11.855,1.957-17.476,3.428L181.97,0.576
        c-3.624-1.318-7.691-0.329-10.305,2.502c-2.615,2.832-3.285,6.949-1.689,10.46l23.39,51.362
        c-28.522,27.498-46.601,62.202-58.166,83.029c-15.834,28.496-54.646,106.542-54.646,106.542c-4.89,9.533-1.544,21.218,7.639,26.737
        l45.452,27.271c10.563,6.341,23.875,5.848,33.953-1.266L209.138,277.882z M213.441,140.424c11.273,0,20.415,9.132,20.415,20.404
        c0,11.263-9.142,20.405-20.415,20.405c-11.263,0-20.405-9.142-20.405-20.405C193.036,149.556,202.178,140.424,213.441,140.424z"/>
    </g>
  </svg>`,

  cannon: `<svg version="1.0" xmlns="http://www.w3.org/2000/svg" viewBox="-64 -64 640 640" preserveAspectRatio="xMidYMid meet">
    <g transform="translate(0.000000,512.000000) scale(0.100000,-0.100000)" fill="currentColor" stroke="none">
      <path d="M4153 5019 c-127 -76 -139 -118 -70 -239 23 -41 193 -328 377 -638 351 -592 351 -592 421 -592 45 0 197 86 221 125 33 54 25 80 -85 266 -538 913 -653 1102 -679 1115 -50 26 -97 16 -185 -37z"/>
      <path d="M2735 3939 c-720 -345 -1385 -664 -1476 -707 l-166 -79 -139 205 c-156 232 -165 242 -198 242 -28 0 -247 -102 -265 -123 -21 -26 -10 -79 21 -96 25 -14 32 -13 123 28 52 24 97 42 99 40 11 -13 229 -336 232 -344 3 -6 -81 -52 -187 -103 -182 -88 -195 -96 -268 -170 -246 -247 -274 -649 -66 -962 43 -65 181 -207 191 -197 3 3 12 38 20 79 79 385 317 738 647 961 497 335 1170 344 1667 22 40 -25 78 -44 85 -41 7 2 351 230 764 506 552 368 750 504 744 514 -171 292 -509 856 -513 855 -3 -1 -594 -284 -1315 -630z"/>
      <path d="M1925 2825 c-279 -49 -530 -176 -732 -368 -122 -117 -208 -233 -283 -379 -106 -208 -150 -395 -150 -633 0 -238 44 -425 150 -633 205 -402 585 -677 1035 -749 121 -19 382 -13 492 12 276 61 506 187 703 385 199 198 325 431 386 710 27 121 27 429 0 550 -61 279 -187 512 -386 710 -197 198 -426 323 -703 385 -101 23 -405 29 -512 10z m488 -479 c320 -96 560 -342 649 -667 33 -121 33 -347 0 -468 -90 -331 -335 -577 -668 -673 -68 -20 -101 -23 -244 -22 -150 0 -173 3 -253 27 -345 106 -588 370 -662 720 -19 88 -19 276 0 364 61 287 242 526 494 652 159 80 261 102 451 97 121 -3 160 -8 233 -30z"/>
      <path d="M2001 2239 c-177 -35 -358 -143 -471 -282 -87 -106 -180 -326 -180 -424 l0 -23 370 0 370 0 0 370 0 370 -22 -1 c-13 -1 -43 -5 -67 -10z"/>
      <path d="M2220 1880 l0 -370 371 0 371 0 -7 43 c-55 346 -303 612 -637 682 -38 8 -76 15 -84 15 -12 0 -14 -55 -14 -370z"/>
      <path d="M1350 1357 c0 -98 93 -318 180 -424 121 -149 321 -262 508 -288 l52 -7 0 371 0 371 -370 0 -370 0 0 -23z"/>
      <path d="M2220 1010 c0 -346 1 -370 18 -370 9 0 54 9 99 20 328 78 564 338 618 678 l7 42 -371 0 -371 0 0 -370z"/>
      <path d="M115 2118 c-87 -51 -115 -76 -115 -102 0 -12 67 -133 148 -271 113 -192 154 -252 174 -259 21 -8 40 -1 118 44 l92 53 -55 51 c-132 121 -226 282 -272 460 -8 32 -16 60 -18 62 -1 2 -34 -15 -72 -38z"/>
    </g>
  </svg>`,

  tower: `<svg version="1.1" xmlns="http://www.w3.org/2000/svg" viewBox="-76 -76 664 664" preserveAspectRatio="xMidYMid meet">
    <style type="text/css">
      .st0{fill:currentColor;}
    </style>
    <g>
      <path class="st0" d="M115.177,431.387h281.647c0,0,19.259-3.795,19.259-22.736c0-28.422-26.138-38.79-38.519-54.953
        c-52.275-65.603-48.468-225.342-48.468-225.342H182.904c0,0,3.809,159.739-48.492,225.342
        c-12.358,16.164-38.495,26.532-38.495,54.953C95.917,427.592,115.177,431.387,115.177,431.387z"/>
      <polygon class="st0" points="329.096,108.397 374.714,79.863 374.714,0 320.178,0 320.178,43.359 281.659,43.359 281.659,0 
        230.317,0 230.317,43.359 191.822,43.359 191.822,0 137.261,0 137.261,79.863 182.904,108.397 	"/>
      <polygon class="st0" points="115.177,451.348 99.479,477.78 99.479,512 412.521,512 412.521,477.78 396.824,451.348 	"/>
    </g>
  </svg>`,

  carriage: `<svg version="1.0" xmlns="http://www.w3.org/2000/svg" viewBox="-64 -64 640 640" preserveAspectRatio="xMidYMid meet">
    <g transform="translate(0.000000,512.000000) scale(0.100000,-0.100000)" fill="currentColor" stroke="none">
      <path d="M1198 4299 c-10 -5 -18 -20 -18 -32 -1 -38 412 -1541 428 -1559 14 -17 52 -18 534 -18 l518 0 10 23 c6 12 104 366 219 787 180 660 207 768 196 785 -12 20 -25 20 -941 22 -619 2 -935 -1 -946 -8z"/>
      <path d="M482 3905 c-260 -174 -475 -322 -478 -329 -7 -18 145 -857 158 -873 15 -18 1218 -19 1236 -1 7 7 12 21 12 31 0 28 -391 1460 -403 1475 -5 6 -19 12 -31 12 -11 0 -234 -142 -494 -315z"/>
      <path d="M3262 4204 c-5 -11 -99 -347 -208 -747 -154 -565 -196 -732 -188 -745 10 -16 60 -17 621 -20 481 -2 613 1 621 10 13 17 166 854 158 873 -8 21 -937 638 -968 643 -18 3 -29 -2 -36 -14z"/>
      <path d="M190 2500 c-18 -18 -20 -33 -20 -141 l0 -122 130 -132 c141 -144 144 -149 111 -221 -47 -103 -56 -153 -55 -309 0 -137 3 -157 28 -235 56 -168 142 -305 229 -362 357 -237 764 -213 1038 61 123 123 196 270 220 437 6 44 15 85 21 92 8 9 69 12 243 12 174 0 235 -3 243 -12 5 -7 15 -49 22 -93 26 -171 98 -313 220 -436 375 -376 1006 -265 1230 216 41 86 70 190 70 246 0 19 7 45 16 57 l15 22 427 0 426 0 139 92 c147 97 177 126 177 165 0 32 -51 83 -83 83 -15 0 -79 -36 -154 -85 l-128 -85 -411 0 c-313 0 -414 3 -427 13 -15 11 -61 121 -74 175 -5 20 14 44 115 145 66 67 125 132 131 144 18 35 14 244 -5 271 l-15 22 -1930 0 c-1916 0 -1929 0 -1949 -20z m824 -356 c13 -12 16 -40 16 -135 0 -195 -20 -203 -157 -67 -51 51 -93 101 -93 110 0 21 64 64 134 88 64 23 81 24 100 4z m353 -28 c103 -49 102 -64 -16 -179 -86 -85 -114 -100 -139 -75 -17 17 -17 269 1 287 18 18 68 7 154 -33z m1691 32 c8 -8 12 -56 12 -149 0 -129 -1 -138 -20 -144 -34 -11 -54 2 -138 89 -117 119 -112 138 53 197 61 21 77 23 93 7z m324 -18 c66 -24 108 -55 108 -78 0 -9 -42 -58 -92 -109 -136 -137 -158 -128 -158 65 0 161 11 171 142 122z m-2625 -313 c77 -77 91 -96 86 -116 -8 -33 -41 -41 -163 -41 -90 0 -112 3 -131 19 -22 17 -22 21 -10 62 13 45 55 134 73 157 23 27 53 10 145 -81z m889 18 c20 -41 38 -92 41 -114 5 -37 3 -41 -21 -51 -15 -5 -76 -10 -134 -10 -113 0 -152 12 -152 48 0 9 42 58 92 109 118 118 126 119 174 18z m1153 -19 c82 -82 93 -97 87 -120 -8 -33 -41 -39 -180 -34 -119 3 -130 10 -122 67 6 39 62 162 79 173 26 17 46 4 136 -86z m878 55 c12 -18 33 -65 45 -103 l23 -70 -24 -19 c-20 -16 -40 -19 -131 -19 -130 0 -160 9 -160 47 0 20 21 47 89 116 100 100 119 106 158 48z m-2835 -410 c8 -22 -1 -34 -86 -118 -111 -112 -126 -115 -168 -38 -15 28 -35 73 -45 102 -26 81 -20 84 150 81 137 -3 140 -3 149 -27z m845 12 c9 -22 -12 -97 -46 -163 -43 -82 -55 -80 -167 31 -137 137 -132 149 68 149 120 0 139 -2 145 -17z m1199 -9 c6 -23 -5 -37 -87 -120 -118 -119 -127 -120 -174 -22 -19 40 -38 87 -41 105 -11 58 1 63 157 63 l139 0 6 -26z m845 10 c10 -13 9 -27 -9 -83 -13 -38 -33 -84 -45 -102 -38 -56 -57 -51 -153 42 -82 81 -102 113 -90 144 8 23 278 22 297 -1z m-2711 -183 c5 -11 10 -73 10 -138 0 -168 -6 -174 -142 -123 -66 24 -108 55 -108 78 0 9 42 58 92 109 96 96 127 112 148 74z m331 -68 c117 -114 119 -130 17 -178 -40 -19 -87 -38 -105 -41 -58 -11 -63 2 -63 150 0 192 18 200 151 69z m1707 75 c19 -19 16 -272 -3 -288 -21 -17 -67 -7 -153 35 -101 48 -99 61 16 177 87 86 114 102 140 76z m339 -80 c51 -51 93 -100 93 -109 0 -30 -62 -69 -152 -95 -57 -18 -84 -12 -92 19 -9 36 -7 224 4 251 17 47 47 33 147 -66z"/>
    </g>
  </svg>`,

  archer: `<svg version="1.1" xmlns="http://www.w3.org/2000/svg" viewBox="-64 -64 640 640" preserveAspectRatio="xMidYMid meet">
    <style type="text/css">
      .st0{fill:currentColor;}
    </style>
    <g>
      <path class="st0" d="M150.037,428.586c1.781,4.797,3.529,9.878,5.267,15.189l157.583-44.245l-13.047-13.037L150.037,428.586z"/>
      <path class="st0" d="M386.406,298.43l13.026,13.026l43.676-155.485c-5.496-1.781-10.501-3.53-15.221-5.234L386.406,298.43z"/>
      <path class="st0" d="M109.409,129.22c2.93-3.321,5.956-6.567,9.059-9.746c3.737-3.672,7.606-7.179,11.54-10.589L83.993,62.87
        l36.245-14.676c2.972-1.179,4.874-4.109,4.721-7.299c-0.142-3.169-2.272-5.945-5.322-6.884L10.429,0.332
        c-2.688-0.819-5.584-0.098-7.561,1.88C0.89,4.19,0.158,7.096,0.999,9.773l33.668,109.208c0.929,3.059,3.682,5.18,6.872,5.322
        c3.192,0.131,6.12-1.738,7.322-4.677l14.675-36.289L109.409,129.22z"/>
      <path class="st0" d="M339.878,318.755L190.402,169.28c-2.983,2.623-5.889,5.333-8.731,8.152l-2.272,2.328l-2.71,2.656
        c-2.348,2.371-4.621,4.786-6.84,7.233L319.4,339.222l-3.956,40.136l61.543,61.543l7.726-56.833l56.854-7.736L380.014,314.8
        L339.878,318.755z"/>
      <path class="st0" d="M500.903,85.522c-13.921-13.932-36.584-13.932-50.505,0c-2.699,2.688-4.918,5.747-6.622,9.135
        c-6.982-0.405-16.752-4.459-23.046-7.07l-10.13-3.78c-3.584-1.378-7.409-2.754-11.058-3.989
        c-31.34-10.545-62.439-16.314-92.424-17.177c-32.892-1.038-65.783,4.25-95.068,15.309c-29.701,11.036-58.057,29.253-82.086,52.746
        c-23.429,23.953-41.633,52.32-52.67,81.978c-11.059,29.328-16.347,62.22-15.32,95.089c0.853,30.006,6.644,61.105,17.188,92.456
        c1.236,3.628,2.612,7.452,3.967,11.004l3.868,10.348c2.547,6.131,6.601,15.877,7.005,22.87c-3.387,1.705-6.459,3.923-9.146,6.612
        c-13.921,13.921-13.921,36.584,0,50.505c13.921,13.922,36.584,13.922,50.506,0c7.408-7.408,11.156-17.548,10.359-27.974
        l0.044-0.239l-0.087-0.832c-0.306-2.961-0.82-5.551-1.301-7.824c-0.743-3.825-1.737-7.223-2.688-10.502l-0.798-2.742
        c-2.534-8.086-5.278-15.691-7.9-22.772l-12.053-31.668c-1.202-3.256-2.262-6.326-3.344-9.649
        c-8.807-26.444-12.829-53.228-11.999-79.584c0.896-26.674,6.95-53.02,17.55-76.186c10.25-22.423,24.466-42.825,42.266-60.614
        l2.536-2.492l2.36-2.415c17.8-17.789,38.191-32.017,60.625-42.245c23.166-10.621,49.5-16.686,76.163-17.56
        c26.38-0.841,53.15,3.19,79.606,11.988c3.311,1.082,6.393,2.153,9.583,3.311l31.778,12.107c7.037,2.6,14.654,5.354,22.882,7.934
        l2.579,0.754c3.288,0.94,6.687,1.934,10.403,2.667c2.381,0.491,4.983,1.016,7.889,1.31l1.006,0.077l0.142-0.032
        c10.403,0.787,20.554-2.962,27.94-10.359C514.825,122.096,514.825,99.432,500.903,85.522z"/>
    </g>
  </svg>`,

  pawn: `<svg viewBox="0 0 26 26" fill="none" xmlns="http://www.w3.org/2000/svg">
    <!-- Head -->
    <circle cx="13" cy="7" r="3.5" fill="currentColor" opacity=".85"/>
    <!-- Neck -->
    <rect x="11.5" y="10" width="3" height="2.5" fill="currentColor" opacity=".7"/>
    <!-- Body -->
    <path d="M8 22 L9 14 Q13 12 17 14 L18 22 Z" fill="currentColor" opacity=".75"/>
    <!-- Base -->
    <rect x="7" y="21" width="12" height="2.5" rx="1.2" fill="currentColor" opacity=".65"/>
  </svg>`,

  crossbow: `<svg version="1.1" id="Layer_1" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="-64 -64 640 640" xml:space="preserve">
    <g fill="currentColor">
      <g>
        <path d="M505.749,354.901l-15.083-15.083c-18.923-18.923-48.768-22.805-72.448-12.139l-44.245-44.224l-13.909-208.64
          l23.317-23.317c8.341-8.341,8.341-21.845,0-30.165c-8.341-8.341-21.824-8.341-30.165,0l-30.165,30.165
          c-19.605,19.584-78.272,38.101-92.928,41.536c-12.288,2.624-23.893,7.019-34.453,12.096l-53.653-53.632
          c-8.32-8.341-21.824-8.341-30.165,0L96.768,66.581L72.832,42.667h8.832c11.797,0,21.333-9.557,21.333-21.333
          C102.997,9.536,93.461,0,81.664,0H21.333c-2.773,0-5.547,0.555-8.149,1.643C7.979,3.797,3.819,7.957,1.643,13.163
          C0.576,15.787,0,18.539,0,21.333v60.331c0,11.797,9.536,21.333,21.333,21.333c11.797,0,21.333-9.536,21.333-21.333v-8.832
          l23.915,23.915l-15.083,15.083c-3.989,4.011-6.251,9.429-6.251,15.083c0,5.675,2.261,11.093,6.251,15.083l53.12,53.12
          c-5.568,11.264-10.112,23.381-11.669,35.648c-2.325,10.944-21.184,72.021-41.451,92.267l-30.165,30.165
          c-8.32,8.341-8.32,21.845,0,30.165c4.181,4.181,9.621,6.251,15.083,6.251c5.461,0,10.923-2.069,15.083-6.251l23.339-23.317
          l208.597,13.888l44.075,44.075c-11.264,23.765-7.317,53.013,12.309,72.661l15.083,15.083c4.16,4.16,9.621,6.251,15.083,6.251
          c5.461,0,10.923-2.091,15.083-6.251l120.683-120.683c4.011-3.989,6.251-9.429,6.251-15.083S509.76,358.891,505.749,354.901z
           M105.045,319.296c18.432-35.285,29.504-77.888,30.037-81.984c0.405-3.115,1.152-6.336,2.155-9.579l100.395,100.395
          L105.045,319.296z M228.373,137.856c3.52-1.195,7.083-2.325,10.709-3.093c0.576-0.128,44.075-10.923,80.213-29.739l8.853,132.587
          L228.373,137.856z"/>
      </g>
    </g>
  </svg>`,
};

// Promoted versions — overlay a subtle glow ring on top of the base SVG
export function getSVGForPiece(type, promoted) {
  // Pawn promotion visually becomes a crossbow
  const visualType =
    type === 'pawn' && promoted
      ? 'crossbow'
      : type;

  const base = SVG[visualType] ?? SVG['pawn'];

  if (!promoted) return base;

  // Force promoted pieces to render in red
  return base
    .replace(/currentColor/g, '#d73b3b')
    .replace(/color:\s*#[0-9a-fA-F]+/g, 'color:#d73b3b')
    .replace(/color:\s*currentColor/g, 'color:#d73b3b');
}

// ── Public API ────────────────────────────────────────────

export function getPieceStyle() {
  return localStorage.getItem(STORAGE_KEY) ?? null;
}

export function setPieceStyle(style) {
  localStorage.setItem(STORAGE_KEY, style);
}

/**
 * Show the startup style-picker popup.
 * Returns a Promise that resolves with the chosen style string.
 * If already chosen, resolves immediately.
 */
export function showStylePicker() {
  return new Promise(resolve => {
    const existing = getPieceStyle();
    if (existing) { resolve(existing); return; }
    _buildStylePicker(resolve);
  });
}

/**
 * Always show the style-picker, even if a preference is already saved.
 * Resolves with the chosen style and triggers a board re-render.
 */
export function openStylePicker() {
  return new Promise(resolve => {
    _buildStylePicker(chosen => {
      try {
        import('./gameplay.js').then(({ render }) => render()).catch(() => {});
      } catch (_) {}
      resolve(chosen);
    });
  });
}

function _buildStylePicker(resolve) {
    const overlay = document.createElement('div');
    overlay.id = 'stylePicker';
    overlay.innerHTML = `
      <div class="sp-backdrop"></div>
      <div class="sp-card" role="dialog" aria-modal="true" aria-labelledby="sp-title">
        <div class="sp-header">
          <div class="sp-crown">♟</div>
          <h2 id="sp-title">Choose piece style</h2>
          <p>How should piece symbols look on the board?<br>You can change this later in Settings.</p>
        </div>

        <div class="sp-options">
          <!-- KANJI option -->
          <button class="sp-option" data-style="kanji" aria-label="Kanji style">
            <div class="sp-preview sp-preview--kanji">
              <div class="sp-tile sp-tile--white">
                <span class="sp-kanji">王</span>
                <span class="sp-sub">KI</span>
              </div>
              <div class="sp-tile sp-tile--black">
                <span class="sp-kanji">後</span>
                <span class="sp-sub">QU</span>
              </div>
              <div class="sp-tile sp-tile--white sp-tile--promoted">
                <span class="sp-kanji">駿</span>
                <span class="sp-sub">HO</span>
              </div>
              <div class="sp-tile sp-tile--black">
                <span class="sp-kanji">炮</span>
                <span class="sp-sub">CA</span>
              </div>
            </div>
            <div class="sp-label">
              <strong>漢字 Kanji</strong>
              <span>Traditional East-Asian characters</span>
            </div>
            <div class="sp-check">✓</div>
          </button>

          <!-- UNIVERSAL option -->
          <button class="sp-option" data-style="universal" aria-label="Universal style">
            <div class="sp-preview sp-preview--universal">
              <div class="sp-tile sp-tile--white">
                <span class="sp-svg">${SVG['king']}</span>
                <span class="sp-sub">KI</span>
              </div>
              <div class="sp-tile sp-tile--black">
                <span class="sp-svg">${SVG['queen']}</span>
                <span class="sp-sub">QU</span>
              </div>
              <div class="sp-tile sp-tile--white sp-tile--promoted">
                <span class="sp-svg">${getSVGForPiece('horse', true)}</span>
                <span class="sp-sub">HO</span>
              </div>
              <div class="sp-tile sp-tile--black">
                <span class="sp-svg">${SVG['cannon']}</span>
                <span class="sp-sub">CA</span>
              </div>
            </div>
            <div class="sp-label">
              <strong>Universal icons</strong>
              <span>Illustrated piece symbols</span>
            </div>
            <div class="sp-check">✓</div>
          </button>
        </div>

        <p class="sp-note">Both styles keep the same color coding — white pieces / black pieces / red promoted.</p>
      </div>
    `;

    // Inject scoped styles
    const style = document.createElement('style');
    style.textContent = `
      #stylePicker {
        position: fixed;
        inset: 0;
        z-index: 9999;
        display: grid;
        place-items: center;
        padding: 16px;
        font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
      }

      .sp-backdrop {
        position: absolute;
        inset: 0;
        background: rgba(0,0,0,.72);
        backdrop-filter: blur(8px);
        -webkit-backdrop-filter: blur(8px);
      }

      .sp-card {
        position: relative;
        background: #13171f;
        border: 1px solid #2d3442;
        border-radius: 22px;
        padding: 28px 24px 22px;
        width: min(560px, 100%);
        box-shadow: 0 40px 100px rgba(0,0,0,.7), 0 0 0 1px rgba(255,255,255,.04) inset;
        animation: sp-in .32s cubic-bezier(.22,1,.36,1) both;
      }

      @keyframes sp-in {
        from { opacity: 0; transform: translateY(24px) scale(.96); }
        to   { opacity: 1; transform: translateY(0) scale(1); }
      }

      .sp-header {
        text-align: center;
        margin-bottom: 22px;
      }

      .sp-crown {
        font-size: 2rem;
        margin-bottom: 8px;
        filter: drop-shadow(0 0 10px rgba(138,180,255,.5));
      }

      .sp-header h2 {
        margin: 0 0 6px;
        font-size: 1.25rem;
        color: #f3f6fb;
        letter-spacing: -.01em;
      }

      .sp-header p {
        margin: 0;
        color: #aab3c2;
        font-size: .85rem;
        line-height: 1.5;
      }

      .sp-options {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 12px;
        margin-bottom: 14px;
      }

      .sp-option {
        background: rgba(255,255,255,.04);
        border: 1.5px solid #2d3442;
        border-radius: 16px;
        padding: 14px 12px 12px;
        cursor: pointer;
        text-align: left;
        transition: border-color .18s, background .18s, transform .14s;
        display: grid;
        gap: 10px;
        color: #f3f6fb;
        position: relative;
        overflow: hidden;
      }

      .sp-option::before {
        content: '';
        position: absolute;
        inset: 0;
        border-radius: 16px;
        background: radial-gradient(ellipse at 50% 0%, rgba(138,180,255,.08), transparent 70%);
        opacity: 0;
        transition: opacity .2s;
      }

      .sp-option:hover {
        border-color: #8ab4ff;
        background: rgba(138,180,255,.06);
        transform: translateY(-2px);
      }

      .sp-option:hover::before { opacity: 1; }

      .sp-option:focus-visible {
        outline: 2px solid #8ab4ff;
        outline-offset: 2px;
      }

      .sp-option.selected {
        border-color: #8ab4ff;
        background: rgba(138,180,255,.1);
        box-shadow: 0 0 0 1px rgba(138,180,255,.3) inset;
      }

      .sp-check {
        display: none;
        position: absolute;
        top: 10px;
        right: 10px;
        width: 20px;
        height: 20px;
        background: #8ab4ff;
        color: #08111f;
        border-radius: 50%;
        font-size: 11px;
        font-weight: 900;
        place-items: center;
      }

      .sp-option.selected .sp-check { display: grid; }

      /* Preview tiles */
      .sp-preview {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 6px;
      }

      .sp-tile {
        width: 100%;
        aspect-ratio: 1;
        border-radius: 50%;
        border: 1.5px solid rgba(255,255,255,.14);
        box-shadow: 0 3px 8px rgba(0,0,0,.3);
        display: grid;
        place-items: center;
        position: relative;
        overflow: hidden;
      }

      .sp-tile--white {
        background: #f4f4f4;
        color: #111;
      }

      .sp-tile--black {
        background: #151515;
        color: #fafafa;
      }

      .sp-tile--promoted .sp-kanji,
      .sp-tile--promoted .sp-svg svg {
        color: #d73b3b !important;
        fill: #d73b3b !important; /* for SVG currentColor via fill */
      }

      .sp-tile--promoted {
        box-shadow: 0 0 0 1.5px #d73b3b inset, 0 3px 8px rgba(0,0,0,.3);
      }

      .sp-kanji {
        font-size: 1.1rem;
        font-weight: 700;
        line-height: 1;
        display: block;
      }

      .sp-sub {
        position: absolute;
        bottom: 2px;
        right: 3px;
        font-size: 7px;
        opacity: .6;
        font-weight: 700;
        line-height: 1;
      }

      .sp-svg {
        display: block;
        width: 62%;
        height: 62%;
        line-height: 0;
      }

      .sp-svg svg {
        width: 100%;
        height: 100%;
        display: block;
      }

      /* SVG color inherits from tile */
      .sp-tile--white .sp-svg svg { color: #111; }
      .sp-tile--black .sp-svg svg { color: #fafafa; }
      .sp-tile--promoted .sp-svg svg { color: #d73b3b; }

      .sp-label {
        display: grid;
        gap: 2px;
      }

      .sp-label strong {
        font-size: .88rem;
        font-weight: 700;
        color: #f3f6fb;
      }

      .sp-label span {
        font-size: .75rem;
        color: #aab3c2;
        line-height: 1.35;
      }

      .sp-note {
        text-align: center;
        color: #aab3c2;
        font-size: .76rem;
        margin: 0;
        line-height: 1.5;
      }

      @media (max-width: 480px) {
        .sp-card { padding: 20px 14px 18px; }
        .sp-options { grid-template-columns: 1fr; }
        .sp-preview { grid-template-columns: repeat(4, 1fr); }
      }
    `;

    document.head.appendChild(style);
    document.body.appendChild(overlay);

    // Click handler
    overlay.querySelectorAll('.sp-option').forEach(btn => {
      btn.addEventListener('click', () => {
        const chosen = btn.dataset.style;
        btn.classList.add('selected');
        setPieceStyle(chosen);

        // Animate out
        const card = overlay.querySelector('.sp-card');
        card.style.transition = 'opacity .22s, transform .22s';
        card.style.opacity = '0';
        card.style.transform = 'scale(.95)';

        setTimeout(() => {
          overlay.remove();
          style.remove();
          resolve(chosen);
        }, 230);
      });
    });
}