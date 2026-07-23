// ==UserScript==
// @name         bilibili高清视频下载1080P
// @namespace    https://github.com/yjln233/bilibili-video-download
// @version      1.0.0
// @description  Bilibili 全合集/全分P快速解析，支持自定义下拉菜单、当前视频默认勾选、标题/Logo快速下载、批量视频/音频/XML或ASS弹幕字幕、直链优先、DASH无损合流。
// @author       yjln233
// @updateURL    https://cdn.jsdelivr.net/gh/yjln233/bilibili-video-download/BilibiliDownloader.user.js
// @downloadURL  https://cdn.jsdelivr.net/gh/yjln233/bilibili-video-download/BilibiliDownloader.user.js
// @match        https://www.bilibili.com/video/*
// @match        https://www.bilibili.com/list/*
// @icon         https://i0.hdslb.com/bfs/static/jinkela/long/images/512.png
// @require      https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.11.6/dist/ffmpeg.min.js
// @grant        GM_xmlhttpRequest
// @grant        GM_download
// @grant        GM_addStyle
// @grant        unsafeWindow
// @connect      api.bilibili.com
// @connect      comment.bilibili.com
// @connect      *.bilivideo.com
// @connect      bilivideo.com
// @connect      *.bilivideo.cn
// @connect      bilivideo.cn
// @connect      cdn.jsdelivr.net
// @run-at       document-idle
// @license      MIT
// ==/UserScript==

(function () {
  'use strict';

  const PANEL_ID = 'tm-bili-downloader';
  const BILI_BLUE = '#00AEEC';

  const FALLBACK_LOGO =
    'https://i0.hdslb.com/bfs/static/jinkela/long/images/512.png';

  const CORE_PATH =
    'https://cdn.jsdelivr.net/npm/@ffmpeg/core-st@0.11.1/dist/ffmpeg-core.js';

  const QUALITY_FALLBACK = [
    { qn: 127, label: '8K 超高清' },
    { qn: 126, label: '杜比视界' },
    { qn: 125, label: 'HDR 真彩' },
    { qn: 120, label: '4K 超清' },
    { qn: 116, label: '1080P 60帧' },
    { qn: 112, label: '1080P 高码率' },
    { qn: 80, label: '1080P 高清' },
    { qn: 74, label: '720P 60帧' },
    { qn: 64, label: '720P 高清' },
    { qn: 32, label: '480P 清晰' },
    { qn: 16, label: '360P 流畅' },
  ];

  const CODECS = {
    auto: {
      ids: [7, 12, 13],
      label: '自动（优先 H.264）',
    },

    avc: {
      ids: [7],
      label: 'AVC / H.264',
    },

    hevc: {
      ids: [12],
      label: 'HEVC / H.265',
    },

    av1: {
      ids: [13],
      label: 'AV1',
    },
  };

  const state = {
    href: location.href,

    videoData: null,

    items: [],

    collectionTitle: '',

    hasCollection: false,

    formats: [],

    selectedKeys: new Set(),

    search: '',

    busy: false,

    initSeq: 0,

    scrollCurrentPending: false,
  };

  const $ = (
    selector,
    root = document
  ) =>
    root.querySelector(
      selector
    );

  const $$ = (
    selector,
    root = document
  ) => [
    ...root.querySelectorAll(
      selector
    ),
  ];

  const sleep = ms =>
    new Promise(
      resolve =>
        setTimeout(
          resolve,
          ms
        )
    );

  function unsafeWindowSafe() {
    try {
      return typeof unsafeWindow !==
        'undefined'
        ? unsafeWindow
        : window;
    } catch {
      return window;
    }
  }

  function sanitize(name) {
    return (
      String(
        name ||
        'bilibili_video'
      )
        .replace(
          /[\\/:*?"<>|\u0000-\u001f]+/g,
          '_'
        )
        .replace(
          /\s+/g,
          ' '
        )
        .replace(
          /[. ]+$/g,
          ''
        )
        .trim()
        .slice(
          0,
          180
        ) ||
      'bilibili_video'
    );
  }

  function escapeHtml(text) {
    return String(
      text
    ).replace(
      /[&<>'"]/g,

      c => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        "'": '&#39;',
        '"': '&quot;',
      })[c]
    );
  }

  function pad(
    n,
    width = 2
  ) {
    return String(
      n
    ).padStart(
      width,
      '0'
    );
  }

  function formatBytes(bytes) {
    if (
      !Number.isFinite(
        bytes
      ) ||
      bytes <= 0
    ) {
      return '未知';
    }

    const units = [
      'B',
      'KB',
      'MB',
      'GB',
    ];

    let n = bytes;
    let i = 0;

    while (
      n >= 1024 &&
      i <
        units.length - 1
    ) {
      n /= 1024;
      i += 1;
    }

    return `${n.toFixed(
      i >= 2
        ? 2
        : 1
    )} ${units[i]}`;
  }

  function setStatus(
    text,
    type = ''
  ) {
    const el =
      $(
        `#${PANEL_ID} .tm-status`
      );

    if (!el) {
      return;
    }

    el.textContent =
      text;

    el.dataset.type =
      type;
  }

  function setProgress(
    value,
    text = ''
  ) {
    const p =
      Math.max(
        0,
        Math.min(
          100,
          Number(
            value
          ) || 0
        )
      );

    const fill =
      $(
        `#${PANEL_ID} .tm-progress-fill`
      );

    const label =
      $(
        `#${PANEL_ID} .tm-progress-text`
      );

    if (
      fill
    ) {
      fill.style.width =
        `${p}%`;
    }

    if (
      label
    ) {
      label.textContent =
        text ||
        `${p.toFixed(
          0
        )}%`;
    }
  }

  function setBusy(busy) {
    state.busy =
      busy;

    $$(
      `#${PANEL_ID} button,
       #${PANEL_ID} input`
    ).forEach(
      el => {
        if (
          el.classList.contains(
            'tm-min-btn'
          )
        ) {
          return;
        }

        el.disabled =
          busy;
      }
    );

    updateSelectAllState();
  }

  /*
   * =========================================================
   * Logo
   * =========================================================
   */

  function findOfficialLogo() {
    const selectors = [
      '#biliMainHeader .mini-header__logo',
      '.bili-header .mini-header__logo',
      '.left-entry__title .mini-header__logo',
      '.mini-header__logo',
      '.zhuzhan-icon',
    ];

    for (
      const selector
      of selectors
    ) {
      const element =
        document.querySelector(
          selector
        );

      if (
        !element ||
        element.closest(
          `#${PANEL_ID}`
        )
      ) {
        continue;
      }

      if (
        element.tagName
          ?.toLowerCase() ===
        'svg'
      ) {
        return element;
      }

      const svg =
        element.querySelector
          ?.(
            'svg'
          );

      if (
        svg
      ) {
        return svg;
      }
    }

    return null;
  }

  function mountOfficialLogo() {
    const host =
      $(
        `#${PANEL_ID} .tm-logo-host`
      );

    if (
      !host
    ) {
      return false;
    }

    const official =
      findOfficialLogo();

    if (
      official
    ) {
      const clone =
        official.cloneNode(
          true
        );

      clone.removeAttribute(
        'id'
      );

      clone.removeAttribute(
        'style'
      );

      clone.classList.add(
        'tm-bili-official-svg'
      );

      clone.setAttribute(
        'aria-hidden',
        'true'
      );

      host.innerHTML =
        '';

      host.appendChild(
        clone
      );

      host.classList.add(
        'is-svg'
      );

      return true;
    }

    host.innerHTML = `
      <img
        class="tm-bili-fallback-logo"
        src="${FALLBACK_LOGO}"
        alt="bilibili"
        draggable="false"
      >
    `;

    host.classList.remove(
      'is-svg'
    );

    return false;
  }

  function startLogoWatcher() {
    let attempts =
      0;

    const timer =
      setInterval(
        () => {
          attempts +=
            1;

          if (
            mountOfficialLogo() ||
            attempts >= 30
          ) {
            clearInterval(
              timer
            );
          }
        },

        500
      );
  }

  /*
   * =========================================================
   * API
   * =========================================================
   */

  function getCurrentBvid() {
    const match =
      location.pathname.match(
        /\/video\/(BV[0-9A-Za-z]+)/i
      );

    if (
      match
    ) {
      return match[1];
    }

    const initial =
      unsafeWindowSafe()
        ?.__INITIAL_STATE__;

    return (
      initial
        ?.videoData
        ?.bvid ||
      initial
        ?.bvid ||
      ''
    );
  }

  async function apiJson(url) {
    const res =
      await fetch(
        url,
        {
          credentials:
            'include',

          referrer:
            location.href,

          referrerPolicy:
            'strict-origin-when-cross-origin',

          headers: {
            Accept:
              'application/json, text/plain, */*',
          },
        }
      );

    if (
      !res.ok
    ) {
      throw new Error(
        `API HTTP ${res.status}`
      );
    }

    const json =
      await res.json();

    if (
      json.code !== 0
    ) {
      throw new Error(
        json.message ||
        `API code ${json.code}`
      );
    }

    return json.data;
  }

  async function fetchView(
    bvid
  ) {
    const url =
      new URL(
        'https://api.bilibili.com/x/web-interface/view'
      );

    url.searchParams.set(
      'bvid',
      bvid
    );

    return apiJson(
      url.toString()
    );
  }

  async function fetchPagelist(
    bvid
  ) {
    const url =
      new URL(
        'https://api.bilibili.com/x/player/pagelist'
      );

    url.searchParams.set(
      'bvid',
      bvid
    );

    url.searchParams.set(
      'jsonp',
      'jsonp'
    );

    const data =
      await apiJson(
        url.toString()
      );

    return Array.isArray(
      data
    )
      ? data
      : [];
  }

  function getFreshInitialVideoData(
    currentBvid
  ) {
    const videoData =
      unsafeWindowSafe()
        ?.__INITIAL_STATE__
        ?.videoData;

    if (
      !videoData
    ) {
      return null;
    }

    if (
      videoData.bvid &&
      currentBvid &&
      videoData.bvid !==
        currentBvid
    ) {
      return null;
    }

    return videoData;
  }

  /*
   * =========================================================
   * 合集 / 分P
   * =========================================================
   */

  function extractSeasonEpisodes(
    videoData
  ) {
    const episodes =
      [];

    const sections =
      videoData
        ?.ugc_season
        ?.sections;

    if (
      !Array.isArray(
        sections
      )
    ) {
      return episodes;
    }

    for (
      const section
      of sections
    ) {
      if (
        !Array.isArray(
          section
            ?.episodes
        )
      ) {
        continue;
      }

      for (
        const ep
        of section.episodes
      ) {
        if (
          !ep?.bvid
        ) {
          continue;
        }

        episodes.push({
          bvid:
            ep.bvid,

          title:
            ep.title ||
            ep.arc
              ?.title ||
            ep.bvid,

          cid:
            ep.cid ||
            0,

          isSeason:
            true,
        });
      }
    }

    return episodes;
  }

  async function fetchSeasonArchivesFallback(
    videoData
  ) {
    const seasonId =
      videoData
        ?.ugc_season
        ?.id;

    const mid =
      videoData
        ?.owner
        ?.mid;

    if (
      !seasonId ||
      !mid
    ) {
      return [];
    }

    const archives =
      [];

    let pageNum =
      1;

    let total =
      Infinity;

    while (
      archives.length <
      total
    ) {
      const url =
        new URL(
          'https://api.bilibili.com/x/polymer/web-space/seasons_archives_list'
        );

      url.searchParams.set(
        'mid',
        String(
          mid
        )
      );

      url.searchParams.set(
        'season_id',
        String(
          seasonId
        )
      );

      url.searchParams.set(
        'page_num',
        String(
          pageNum
        )
      );

      url.searchParams.set(
        'page_size',
        '100'
      );

      const data =
        await apiJson(
          url.toString()
        );

      const list =
        Array.isArray(
          data
            ?.archives
        )
          ? data.archives
          : [];

      total =
        Number(
          data
            ?.page
            ?.total ??
          list.length
        );

      for (
        const item
        of list
      ) {
        if (
          !item?.bvid
        ) {
          continue;
        }

        archives.push({
          bvid:
            item.bvid,

          title:
            item.title ||
            item.bvid,

          cid:
            item.cid ||
            0,

          isSeason:
            true,
        });
      }

      if (
        !list.length ||
        archives.length >=
          total
      ) {
        break;
      }

      pageNum +=
        1;

      if (
        pageNum >
        100
      ) {
        break;
      }
    }

    return [
      ...new Map(
        archives.map(
          item => [
            item.bvid,
            item,
          ]
        )
      ).values(),
    ];
  }

  function buildFlatItems(
    tree,
    collectionTitle
  ) {
    const flat =
      [];

    tree.forEach(
      (
        episode,
        episodeIndex
      ) => {
        episode.parts.forEach(
          (
            part,
            partIndex
          ) => {
            flat.push({
              key:
                `${episode.bvid}:${part.cid}`,

              bvid:
                episode.bvid,

              cid:
                part.cid,

              page:
                part.page ||
                partIndex + 1,

              pages:
                episode.parts.length,

              part:
                sanitize(
                  part.part ||
                  `P${partIndex + 1}`
                ),

              videoTitle:
                sanitize(
                  episode.title ||
                  episode.bvid
                ),

              collectionTitle:
                sanitize(
                  collectionTitle ||
                  ''
                ),

              collectionIndex:
                episodeIndex +
                1,

              collectionCount:
                tree.length,

              isSeason:
                episode.isSeason,
            });
          }
        );
      }
    );

    return flat;
  }

  async function parseResourcesFast() {
    const currentBvid =
      getCurrentBvid();

    if (
      !currentBvid
    ) {
      throw new Error(
        '当前页面没有识别到 BV 号'
      );
    }

    setStatus(
      '正在读取合集信息…'
    );

    let videoData =
      getFreshInitialVideoData(
        currentBvid
      );

    if (
      !videoData
    ) {
      videoData =
        await fetchView(
          currentBvid
        );
    }

    state.videoData =
      videoData;

    let rawEpisodes =
      extractSeasonEpisodes(
        videoData
      );

    if (
      !rawEpisodes.length &&
      videoData
        ?.ugc_season
        ?.id
    ) {
      try {
        rawEpisodes =
          await fetchSeasonArchivesFallback(
            videoData
          );
      } catch (err) {
        console.warn(
          '[BiliDL] season fallback failed:',
          err
        );
      }
    }

    if (
      !rawEpisodes.length
    ) {
      rawEpisodes = [
        {
          bvid:
            currentBvid,

          title:
            videoData
              ?.title ||
            currentBvid,

          cid:
            videoData
              ?.cid ||
            0,

          isSeason:
            false,
        },
      ];
    }

    rawEpisodes = [
      ...new Map(
        rawEpisodes.map(
          episode => [
            episode.bvid,
            episode,
          ]
        )
      ).values(),
    ];

    setStatus(
      `正在并发解析 ${rawEpisodes.length} 个视频的分P…`
    );

    const tree =
      await Promise.all(
        rawEpisodes.map(
          async episode => {
            let pages =
              [];

            if (
              episode.bvid ===
                currentBvid &&
              Array.isArray(
                videoData
                  ?.pages
              ) &&
              videoData
                .pages
                .length
            ) {
              pages =
                videoData.pages;
            } else {
              try {
                pages =
                  await fetchPagelist(
                    episode.bvid
                  );
              } catch (err) {
                console.warn(
                  `[BiliDL] pagelist failed: ${episode.bvid}`,
                  err
                );
              }
            }

            if (
              !pages.length
            ) {
              pages = [
                {
                  cid:
                    episode.cid ||
                    (
                      episode.bvid ===
                      currentBvid
                        ? videoData
                            ?.cid
                        : 0
                    ),

                  page:
                    1,

                  part:
                    episode.title,
                },
              ];
            }

            return {
              bvid:
                episode.bvid,

              title:
                episode.title,

              isSeason:
                episode.isSeason,

              parts:
                pages
                  .filter(
                    page =>
                      page
                        ?.cid
                  )
                  .map(
                    (
                      page,
                      index
                    ) => ({
                      cid:
                        page.cid,

                      page:
                        page.page ||
                        index +
                          1,

                      part:
                        page.part ||
                        `P${index + 1}`,
                    })
                  ),
            };
          }
        )
      );

    const collectionTitle =
      videoData
        ?.ugc_season
        ?.title ||
      videoData
        ?.ugc_season
        ?.name ||
      videoData
        ?.title ||
      '合集';

    state.items =
      buildFlatItems(
        tree,
        collectionTitle
      );

    state.hasCollection =
      Boolean(
        videoData
          ?.ugc_season
          ?.id
      ) ||
      rawEpisodes.length >
        1;

    state.collectionTitle =
      state.hasCollection
        ? sanitize(
            collectionTitle
          )
        : '';

    /*
     * 默认只勾选当前视频 / 当前分P。
     */
    state.selectedKeys.clear();

    const currentItem =
      getCurrentItem();

    if (
      currentItem
    ) {
      state.selectedKeys.add(
        currentItem.key
      );
    }

    state.search =
      '';

    state.scrollCurrentPending =
      true;

    const searchInput =
      $(
        `#${PANEL_ID} .tm-search`
      );

    if (
      searchInput
    ) {
      searchInput.value =
        '';
    }

    const searchWrap =
      $(
        `#${PANEL_ID} .tm-search-wrap`
      );

    if (
      searchWrap
    ) {
      searchWrap.classList.remove(
        'open'
      );
    }

    return {
      currentBvid,
      videoData,
      tree,
    };
  }

  /*
   * =========================================================
   * 当前视频
   * =========================================================
   */

  function getCurrentItem() {
    const currentBvid =
      getCurrentBvid();

    if (
      !currentBvid
    ) {
      return null;
    }

    const sameVideo =
      state.items.filter(
        item =>
          item.bvid ===
          currentBvid
      );

    if (
      !sameVideo.length
    ) {
      return null;
    }

    const pParam =
      Number(
        new URL(
          location.href
        ).searchParams.get(
          'p'
        ) ||
        0
      );

    if (
      pParam >
      0
    ) {
      const byPage =
        sameVideo.find(
          item =>
            Number(
              item.page
            ) ===
            pParam
        );

      if (
        byPage
      ) {
        return byPage;
      }
    }

    const currentCid =
      Number(
        state.videoData
          ?.cid ||
        0
      );

    if (
      currentCid
    ) {
      const byCid =
        sameVideo.find(
          item =>
            Number(
              item.cid
            ) ===
            currentCid
        );

      if (
        byCid
      ) {
        return byCid;
      }
    }

    return sameVideo[0];
  }

  function flashCurrentRow(
    row
  ) {
    if (
      !row
    ) {
      return;
    }

    row.classList.remove(
      'tm-current-flash'
    );

    void row.offsetWidth;

    row.classList.add(
      'tm-current-flash'
    );

    setTimeout(
      () => {
        row.classList.remove(
          'tm-current-flash'
        );
      },

      1400
    );
  }

  function scrollCurrentItemToTop() {
    if (
      !state.scrollCurrentPending ||
      state.search
    ) {
      return;
    }

    const panel =
      document.getElementById(
        PANEL_ID
      );

    const list =
      $(
        `#${PANEL_ID} .tm-items`
      );

    if (
      !panel ||
      !list
    ) {
      return;
    }

    if (
      panel.classList.contains(
        'minimized'
      )
    ) {
      return;
    }

    if (
      list.offsetParent ===
        null ||
      list.clientHeight <=
        0
    ) {
      return;
    }

    const currentRow =
      list.querySelector(
        '.tm-item[data-current="1"]'
      );

    if (
      !currentRow
    ) {
      return;
    }

    requestAnimationFrame(
      () => {
        if (
          panel.classList.contains(
            'minimized'
          ) ||
          list.offsetParent ===
            null ||
          list.clientHeight <=
            0
        ) {
          return;
        }

        list.scrollTop =
          Math.max(
            0,
            currentRow.offsetTop
          );

        state.scrollCurrentPending =
          false;

        requestAnimationFrame(
          () => {
            flashCurrentRow(
              currentRow
            );
          }
        );
      }
    );
  }

  /*
   * =========================================================
   * 播放信息
   * =========================================================
   */

  async function fetchPlayData(
    item,
    qn
  ) {
    const url =
      new URL(
        'https://api.bilibili.com/x/player/playurl'
      );

    url.searchParams.set(
      'bvid',
      item.bvid
    );

    url.searchParams.set(
      'cid',
      String(
        item.cid
      )
    );

    url.searchParams.set(
      'qn',
      String(
        qn
      )
    );

    url.searchParams.set(
      'fnver',
      '0'
    );

    url.searchParams.set(
      'fnval',
      '4048'
    );

    url.searchParams.set(
      'fourk',
      '1'
    );

    url.searchParams.set(
      'otype',
      'json'
    );

    return apiJson(
      url.toString()
    );
  }

  /*
   * 尝试获取已经包含音视频的 durl。
   *
   * 能拿到完整单文件时优先直接下载，
   * 不进入 FFmpeg。
   */
  async function fetchDirectPlayData(
    item,
    qn
  ) {
    const url =
      new URL(
        'https://api.bilibili.com/x/player/playurl'
      );

    url.searchParams.set(
      'bvid',
      item.bvid
    );

    url.searchParams.set(
      'cid',
      String(
        item.cid
      )
    );

    url.searchParams.set(
      'qn',
      String(
        qn
      )
    );

    url.searchParams.set(
      'fnver',
      '0'
    );

    url.searchParams.set(
      'fnval',
      '0'
    );

    url.searchParams.set(
      'fourk',
      '0'
    );

    url.searchParams.set(
      'otype',
      'json'
    );

    return apiJson(
      url.toString()
    );
  }

  function normalizeFormats(
    data
  ) {
    const map =
      new Map();

    for (
      const format
      of data
        ?.support_formats ||
      []
    ) {
      const qn =
        Number(
          format
            .quality
        );

      if (
        !qn
      ) {
        continue;
      }

      map.set(
        qn,
        {
          qn,

          label:
            format
              .new_description ||
            format
              .display_desc ||
            format
              .superscript ||
            format
              .format ||
            `画质 ${qn}`,
        }
      );
    }

    for (
      const quality
      of data
        ?.accept_quality ||
      []
    ) {
      const qn =
        Number(
          quality
        );

      if (
        !qn ||
        map.has(
          qn
        )
      ) {
        continue;
      }

      map.set(
        qn,
        {
          qn,

          label:
            QUALITY_FALLBACK.find(
              item =>
                item.qn ===
                qn
            )
              ?.label ||
            `画质 ${qn}`,
        }
      );
    }

    return [
      ...map.values(),
    ].sort(
      (
        a,
        b
      ) =>
        b.qn -
        a.qn
    );
  }

  function codecName(
    codecid
  ) {
    const id =
      Number(
        codecid
      );

    if (
      id === 7
    ) {
      return 'H.264';
    }

    if (
      id === 12
    ) {
      return 'H.265';
    }

    if (
      id === 13
    ) {
      return 'AV1';
    }

    return `codec ${id}`;
  }

  function frameRateName(
    stream
  ) {
    const value =
      String(
        stream
          ?.frameRate ||
        stream
          ?.frame_rate ||
        ''
      ).trim();

    if (
      !value
    ) {
      return '';
    }

    if (
      /^\d+(?:\.\d+)?$/.test(
        value
      )
    ) {
      return `${Math.round(
        Number(
          value
        )
      )}fps`;
    }

    return value
      .toLowerCase()
      .includes(
        'fps'
      )
      ? value
      : `${value}fps`;
  }

  function streamUrls(
    stream
  ) {
    const urls =
      [];

    const add =
      value => {
        if (
          !value
        ) {
          return;
        }

        if (
          Array.isArray(
            value
          )
        ) {
          value.forEach(
            add
          );

          return;
        }

        const url =
          String(
            value
          ).replace(
            /^http:/,
            'https:'
          );

        if (
          url &&
          !urls.includes(
            url
          )
        ) {
          urls.push(
            url
          );
        }
      };

    add(
      stream
        ?.baseUrl
    );

    add(
      stream
        ?.base_url
    );

    add(
      stream
        ?.url
    );

    add(
      stream
        ?.backupUrl
    );

    add(
      stream
        ?.backup_url
    );

    return urls;
  }

  function pickExactVideo(
    data,
    requestedQn,
    codecPref
  ) {
    const videos =
      Array.isArray(
        data
          ?.dash
          ?.video
      )
        ? data
            .dash
            .video
        : [];

    const actualQn =
      Number(
        data
          ?.quality ||
        0
      );

    if (
      actualQn &&
      actualQn !==
        Number(
          requestedQn
        )
    ) {
      if (
        Number(
          requestedQn
        ) >
          80 &&
        actualQn <=
          80
      ) {
        throw new Error(
          '你的账号没有大会员，无法下载此画质视频。'
        );
      }

      throw new Error(
        'B站没有返回所选画质的视频流。'
      );
    }

    const exact =
      videos.filter(
        video =>
          Number(
            video.id
          ) ===
          Number(
            requestedQn
          )
      );

    if (
      !exact.length
    ) {
      throw new Error(
        '当前视频没有所选画质的视频流。'
      );
    }

    const codecIds =
      CODECS[
        codecPref
      ]?.ids ||
      CODECS
        .auto
        .ids;

    for (
      const codecId
      of codecIds
    ) {
      const candidates =
        exact
          .filter(
            video =>
              Number(
                video
                  .codecid
              ) ===
              codecId
          )
          .sort(
            (
              a,
              b
            ) =>
              (
                b.bandwidth ||
                0
              ) -
              (
                a.bandwidth ||
                0
              )
          );

      if (
        candidates.length
      ) {
        return candidates[0];
      }
    }

    throw new Error(
      `当前画质没有 ${
        CODECS[
          codecPref
        ]?.label ||
        codecPref
      } 编码的视频流。`
    );
  }

  function pickAudio(
    data
  ) {
    const list =
      [];

    if (
      Array.isArray(
        data
          ?.dash
          ?.audio
      )
    ) {
      list.push(
        ...data
          .dash
          .audio
      );
    }

    if (
      Array.isArray(
        data
          ?.dash
          ?.dolby
          ?.audio
      )
    ) {
      list.push(
        ...data
          .dash
          .dolby
          .audio
      );
    }

    if (
      data
        ?.dash
        ?.flac
        ?.audio
    ) {
      list.push(
        data
          .dash
          .flac
          .audio
      );
    }

    if (
      !list.length
    ) {
      return null;
    }

    return list.sort(
      (
        a,
        b
      ) =>
        (
          b.bandwidth ||
          0
        ) -
        (
          a.bandwidth ||
          0
        )
    )[0];
  }

  /*
   * =========================================================
   * 下载网络数据
   * =========================================================
   */

  function requestArrayBufferUrl(
    url,
    onProgress
  ) {
    return new Promise(
      (
        resolve,
        reject
      ) => {
        GM_xmlhttpRequest({
          method:
            'GET',

          url,

          responseType:
            'arraybuffer',

          timeout:
            120000,

          headers: {
            Referer:
              'https://www.bilibili.com/',

            Origin:
              'https://www.bilibili.com',
          },

          onprogress:
            event => {
              if (
                typeof onProgress ===
                'function'
              ) {
                onProgress(
                  event.loaded ||
                    0,

                  event.total ||
                    0
                );
              }
            },

          onload:
            response => {
              if (
                response.status >=
                  200 &&
                response.status <
                  300 &&
                response.response
              ) {
                resolve(
                  response.response
                );
              } else {
                reject(
                  new Error(
                    `HTTP ${response.status}`
                  )
                );
              }
            },

          onerror:
            () =>
              reject(
                new Error(
                  '媒体网络请求失败'
                )
              ),

          ontimeout:
            () =>
              reject(
                new Error(
                  '媒体网络请求超时'
                )
              ),
        });
      }
    );
  }

  function requestTextUrl(
    url
  ) {
    return new Promise(
      (
        resolve,
        reject
      ) => {
        GM_xmlhttpRequest({
          method:
            'GET',

          url,

          responseType:
            'text',

          timeout:
            120000,

          headers: {
            Referer:
              'https://www.bilibili.com/',

            Origin:
              'https://www.bilibili.com',
          },

          onload:
            response => {
              const text =
                typeof response
                  .responseText ===
                  'string'
                  ? response
                      .responseText
                  : String(
                      response
                        .response ||
                      ''
                    );

              if (
                response.status >=
                  200 &&
                response.status <
                  300
              ) {
                resolve(
                  text
                );
              } else {
                reject(
                  new Error(
                    `HTTP ${response.status}`
                  )
                );
              }
            },

          onerror:
            () =>
              reject(
                new Error(
                  '文本网络请求失败'
                )
              ),

          ontimeout:
            () =>
              reject(
                new Error(
                  '文本网络请求超时'
                )
              ),
        });
      }
    );
  }

  async function requestStreamBuffer(
    stream,
    onProgress
  ) {
    const urls =
      streamUrls(
        stream
      );

    if (
      !urls.length
    ) {
      throw new Error(
        '媒体直链为空'
      );
    }

    let lastError =
      null;

    for (
      let i = 0;
      i <
      urls.length;
      i += 1
    ) {
      try {
        return await requestArrayBufferUrl(
          urls[i],
          onProgress
        );
      } catch (err) {
        lastError =
          err;

        console.warn(
          `[BiliDL] CDN ${i + 1}/${urls.length} failed:`,
          urls[i],
          err
        );
      }
    }

    throw new Error(
      `所有媒体CDN均下载失败：${
        lastError
          ?.message ||
        lastError ||
        '未知错误'
      }`
    );
  }

  function requestDirectFile(
    url,
    filename,
    onProgress
  ) {
    return new Promise(
      (
        resolve,
        reject
      ) => {
        try {
          GM_download({
            url,

            name:
              filename,

            saveAs:
              false,

            headers: {
              Referer:
                'https://www.bilibili.com/',
            },

            onprogress:
              event => {
                if (
                  typeof onProgress ===
                    'function'
                ) {
                  onProgress(
                    event.loaded ||
                      0,

                    event.total ||
                      0
                  );
                }
              },

            onload:
              () =>
                resolve(),

            onerror:
              error =>
                reject(
                  new Error(
                    `直链下载失败：${
                      error
                        ?.error ||
                      error
                        ?.message ||
                      '未知错误'
                    }`
                  )
                ),

            ontimeout:
              () =>
                reject(
                  new Error(
                    '直链下载超时'
                  )
                ),
          });
        } catch (err) {
          reject(
            err
          );
        }
      }
    );
  }

  function directEntryUrls(
    entry
  ) {
    const urls =
      [];

    const add =
      value => {
        if (
          !value
        ) {
          return;
        }

        if (
          Array.isArray(
            value
          )
        ) {
          value.forEach(
            add
          );

          return;
        }

        const url =
          String(
            value
          ).replace(
            /^http:/,
            'https:'
          );

        if (
          url &&
          !urls.includes(
            url
          )
        ) {
          urls.push(
            url
          );
        }
      };

    add(
      entry
        ?.url
    );

    add(
      entry
        ?.backup_url
    );

    add(
      entry
        ?.backupUrl
    );

    return urls;
  }

  function directFileExtension(
    data,
    entry
  ) {
    const format =
      String(
        data
          ?.format ||
        ''
      ).toLowerCase();

    const url =
      String(
        entry
          ?.url ||
        ''
      ).toLowerCase();

    if (
      format.includes(
        'flv'
      ) ||
      /\.flv(?:\?|$)/.test(
        url
      )
    ) {
      return 'flv';
    }

    return 'mp4';
  }

  async function downloadDirectEntry(
    entry,
    filename,
    onProgress
  ) {
    const urls =
      directEntryUrls(
        entry
      );

    if (
      !urls.length
    ) {
      throw new Error(
        '直链地址为空'
      );
    }

    let lastError =
      null;

    for (
      let i = 0;
      i <
      urls.length;
      i += 1
    ) {
      try {
        await requestDirectFile(
          urls[i],
          filename,
          onProgress
        );

        return;
      } catch (err) {
        lastError =
          err;

        console.warn(
          `[BiliDL] direct CDN ${i + 1}/${urls.length} failed:`,
          urls[i],
          err
        );
      }
    }

    throw new Error(
      `所有直链均下载失败：${
        lastError
          ?.message ||
        lastError ||
        '未知错误'
      }`
    );
  }

  function saveBlob(
    blob,
    filename
  ) {
    const url =
      URL.createObjectURL(
        blob
      );

    const a =
      document.createElement(
        'a'
      );

    a.href =
      url;

    a.download =
      filename;

    a.rel =
      'noopener';

    document.body.appendChild(
      a
    );

    a.click();

    a.remove();

    setTimeout(
      () =>
        URL.revokeObjectURL(
          url
        ),

      60000
    );
  }

  /*
   * =========================================================
   * FFmpeg
   * =========================================================
   */

  async function muxAndSave(
    videoBuf,
    audioBuf,
    outputName
  ) {
    if (
      typeof FFmpeg ===
        'undefined' ||
      !FFmpeg.createFFmpeg
    ) {
      throw new Error(
        'FFmpeg.wasm 没有加载成功'
      );
    }

    setStatus(
      '正在加载 FFmpeg…'
    );

    const ffmpeg =
      FFmpeg.createFFmpeg({
        log:
          false,

        mainName:
          'main',

        corePath:
          CORE_PATH,
      });

    await ffmpeg.load();

    const token =
      `${Date.now()}_${Math.random()
        .toString(36)
        .slice(2)}`;

    const vin =
      `video_${token}.mp4`;

    const ain =
      `audio_${token}.m4a`;

    const out =
      `output_${token}.mp4`;

    try {
      ffmpeg.FS(
        'writeFile',
        vin,
        new Uint8Array(
          videoBuf
        )
      );

      if (
        audioBuf
      ) {
        ffmpeg.FS(
          'writeFile',
          ain,
          new Uint8Array(
            audioBuf
          )
        );
      }

      setStatus(
        '正在无损合流音视频…'
      );

      setProgress(
        96,
        '合流中…'
      );

      try {
        if (
          audioBuf
        ) {
          await ffmpeg.run(
            '-nostdin',
            '-y',

            '-i',
            vin,

            '-i',
            ain,

            '-map',
            '0:v:0',

            '-map',
            '1:a:0',

            '-c',
            'copy',

            '-movflags',
            '+faststart',

            '-shortest',

            out
          );
        } else {
          await ffmpeg.run(
            '-nostdin',
            '-y',

            '-i',
            vin,

            '-c',
            'copy',

            '-movflags',
            '+faststart',

            out
          );
        }
      } catch (err) {
        const message =
          String(
            err
              ?.message ??
            err
          );

        if (
          !/\bexit\(0\)\b/i.test(
            message
          )
        ) {
          throw err;
        }
      }

      const bytes =
        ffmpeg.FS(
          'readFile',
          out
        );

      if (
        !(
          bytes instanceof
          Uint8Array
        ) ||
        !bytes.byteLength
      ) {
        throw new Error(
          'FFmpeg输出MP4为空'
        );
      }

      saveBlob(
        new Blob(
          [
            bytes
              .slice()
              .buffer,
          ],
          {
            type:
              'video/mp4',
          }
        ),

        `${outputName}.mp4`
      );
    } finally {
      for (
        const path
        of [
          vin,
          ain,
          out,
        ]
      ) {
        try {
          ffmpeg.FS(
            'unlink',
            path
          );
        } catch {}
      }

      try {
        ffmpeg.exit();
      } catch {}
    }
  }

  /*
   * =========================================================
   * 自定义下拉框
   * =========================================================
   */

  function dropdownArrowHtml() {
    return `
      <span
        class="tm-select-arrow"
        aria-hidden="true"
      >
        <svg
          viewBox="0 0 20 20"
        >
          <path
            d="M5 7.5L10 12.5L15 7.5"
          ></path>
        </svg>
      </span>
    `;
  }

  function getDropdownRoot(
    name
  ) {
    return $(
      `#${PANEL_ID} .tm-dropdown[data-name="${name}"]`
    );
  }

  function getDropdownValue(
    name
  ) {
    return (
      getDropdownRoot(
        name
      )
        ?.dataset
        ?.value ||
      ''
    );
  }

  function closeDropdowns(
    except = null
  ) {
    $$(
      `#${PANEL_ID} .tm-dropdown.open`
    ).forEach(
      root => {
        if (
          root !==
          except
        ) {
          root.classList.remove(
            'open'
          );
        }
      }
    );
  }

  function setDropdownValue(
    root,
    value,
    label = null
  ) {
    if (
      !root
    ) {
      return;
    }

    const stringValue =
      String(
        value ??
        ''
      );

    root.dataset.value =
      stringValue;

    const options =
      $$(
        '.tm-select-option',
        root
      );

    let selectedLabel =
      label;

    options.forEach(
      option => {
        const selected =
          option.dataset
            .value ===
          stringValue;

        option.classList.toggle(
          'selected',
          selected
        );

        option.setAttribute(
          'aria-selected',
          selected
            ? 'true'
            : 'false'
        );

        if (
          selected &&
          selectedLabel ==
            null
        ) {
          selectedLabel =
            option
              .querySelector(
                '.tm-option-text'
              )
              ?.textContent
              ?.trim() ||
            option
              .textContent
              .trim();
        }
      }
    );

    const labelEl =
      $(
        '.tm-select-label',
        root
      );

    if (
      labelEl
    ) {
      labelEl.textContent =
        selectedLabel ||
        '请选择';
    }
  }

  function setDropdownOptions(
    name,
    options,
    preferredValue = ''
  ) {
    const root =
      getDropdownRoot(
        name
      );

    if (
      !root
    ) {
      return;
    }

    const menu =
      $(
        '.tm-select-menu',
        root
      );

    if (
      !menu
    ) {
      return;
    }

    const normalized =
      (
        options ||
        []
      ).map(
        option => ({
          value:
            String(
              option.value
            ),

          label:
            String(
              option.label
            ),
        })
      );

    menu.innerHTML =
      normalized
        .map(
          option => `
            <button
              type="button"
              class="tm-select-option"
              role="option"
              data-value="${escapeHtml(
                option.value
              )}"
            >
              <span class="tm-option-text">
                ${escapeHtml(
                  option.label
                )}
              </span>

              <span class="tm-option-check">
                ✓
              </span>
            </button>
          `
        )
        .join(
          ''
        );

    if (
      !normalized.length
    ) {
      root.dataset.value =
        '';

      const labelEl =
        $(
          '.tm-select-label',
          root
        );

      if (
        labelEl
      ) {
        labelEl.textContent =
          '无可用选项';
      }

      return;
    }

    const preferred =
      String(
        preferredValue ??
        ''
      );

    const selected =
      normalized.find(
        option =>
          option.value ===
          preferred
      ) ||
      normalized[0];

    setDropdownValue(
      root,
      selected.value,
      selected.label
    );
  }

  function initStaticDropdowns() {
    setDropdownOptions(
      'codec',
      [
        {
          value:
            'auto',

          label:
            '自动（优先 H.264）',
        },

        {
          value:
            'avc',

          label:
            'AVC / H.264',
        },

        {
          value:
            'hevc',

          label:
            'HEVC / H.265',
        },

        {
          value:
            'av1',

          label:
            'AV1',
        },
      ],
      'auto'
    );

    setDropdownOptions(
      'subtitle',
      [
        {
          value:
            'xml',

          label:
            'XML 原始弹幕',
        },

        {
          value:
            'ass',

          label:
            'ASS 播放器字幕',
        },
      ],
      'xml'
    );
  }

  /*
   * =========================================================
   * UI 数据
   * =========================================================
   */

  function getSelectedQn() {
    return Number(
      getDropdownValue(
        'quality'
      ) ||
      0
    );
  }

  function getSelectedCodec() {
    return (
      getDropdownValue(
        'codec'
      ) ||
      'auto'
    );
  }

  function getSelectedSubtitleFormat() {
    return (
      getDropdownValue(
        'subtitle'
      ) ||
      'xml'
    );
  }

  function getVisibleItems() {
    const keyword =
      state.search
        .trim()
        .toLowerCase();

    if (
      !keyword
    ) {
      return state.items;
    }

    return state.items.filter(
      item => {
        const text = [
          item.videoTitle,
          item.part,
          `P${item.page}`,
          item.page,
          item.collectionIndex,
        ]
          .join(
            ' '
          )
          .toLowerCase();

        return text.includes(
          keyword
        );
      }
    );
  }

  function selectedItems() {
    return state.items.filter(
      item =>
        state.selectedKeys.has(
          item.key
        )
    );
  }

  function itemLabel(
    item
  ) {
    if (
      item.pages >
      1
    ) {
      return `${item.videoTitle} / P${item.page} ${item.part}`;
    }

    return item.videoTitle;
  }

  function itemIndexText(
    item,
    visibleIndex
  ) {
    if (
      state.hasCollection
    ) {
      if (
        item.pages >
        1
      ) {
        return `${pad(
          item.collectionIndex,
          2
        )}-${pad(
          item.page,
          2
        )}`;
      }

      return pad(
        item.collectionIndex,
        2
      );
    }

    if (
      item.pages >
      1
    ) {
      return `P${pad(
        item.page,
        2
      )}`;
    }

    return pad(
      visibleIndex +
        1,
      2
    );
  }

  function buildBaseName(
    item,
    qualityLabel,
    stream
  ) {
    const fps =
      frameRateName(
        stream
      );

    const codec =
      codecName(
        stream
          ?.codecid
      );

    const suffix = [
      qualityLabel,
      fps,
      codec,
    ]
      .filter(
        Boolean
      )
      .join(
        ' - '
      );

    if (
      state.hasCollection &&
      item.isSeason
    ) {
      const part =
        item.pages >
        1
          ? ` - P${pad(
              item.page
            )} ${item.part}`
          : '';

      return sanitize(
        `[${pad(
          item.collectionIndex
        )}] ${item.videoTitle}${part} - ${suffix}`
      );
    }

    const part =
      item.pages >
      1
        ? ` - P${pad(
            item.page
          )} ${item.part}`
        : '';

    return sanitize(
      `${item.videoTitle}${part} - ${suffix}`
    );
  }

  function buildPlainBaseName(
    item
  ) {
    if (
      state.hasCollection &&
      item.isSeason
    ) {
      const part =
        item.pages >
        1
          ? ` - P${pad(
              item.page
            )} ${item.part}`
          : '';

      return sanitize(
        `[${pad(
          item.collectionIndex
        )}] ${item.videoTitle}${part}`
      );
    }

    const part =
      item.pages >
      1
        ? ` - P${pad(
            item.page
          )} ${item.part}`
        : '';

    return sanitize(
      `${item.videoTitle}${part}`
    );
  }

  function audioCodecName(
    stream
  ) {
    const codec =
      String(
        stream
          ?.codecs ||
        stream
          ?.codec ||
        ''
      ).toLowerCase();

    if (
      codec.includes(
        'flac'
      )
    ) {
      return 'FLAC';
    }

    if (
      codec.includes(
        'ec-3'
      ) ||
      codec.includes(
        'eac3'
      )
    ) {
      return 'E-AC-3';
    }

    if (
      codec.includes(
        'ac-3'
      ) ||
      codec.includes(
        'ac3'
      )
    ) {
      return 'AC-3';
    }

    if (
      codec.includes(
        'opus'
      )
    ) {
      return 'Opus';
    }

    if (
      codec.includes(
        'mp4a'
      ) ||
      codec.includes(
        'aac'
      )
    ) {
      return 'AAC';
    }

    return codec
      ? codec.toUpperCase()
      : '音频';
  }

  function audioFileExtension(
    stream
  ) {
    const mime =
      String(
        stream
          ?.mimeType ||
        stream
          ?.mime_type ||
        ''
      ).toLowerCase();

    if (
      mime.includes(
        'webm'
      )
    ) {
      return 'webm';
    }

    if (
      mime.includes(
        'ogg'
      )
    ) {
      return 'ogg';
    }

    return 'm4a';
  }

  function buildAudioBaseName(
    item,
    stream
  ) {
    const codec =
      audioCodecName(
        stream
      );

    const bandwidth =
      Number(
        stream
          ?.bandwidth ||
        0
      );

    const bitrate =
      bandwidth >
      0
        ? `${Math.round(
            bandwidth /
            1000
          )}kbps`
        : '';

    const suffix = [
      '音频',
      bitrate,
      codec,
    ]
      .filter(
        Boolean
      )
      .join(
        ' - '
      );

    if (
      state.hasCollection &&
      item.isSeason
    ) {
      const part =
        item.pages >
        1
          ? ` - P${pad(
              item.page
            )} ${item.part}`
          : '';

      return sanitize(
        `[${pad(
          item.collectionIndex
        )}] ${item.videoTitle}${part} - ${suffix}`
      );
    }

    const part =
      item.pages >
      1
        ? ` - P${pad(
            item.page
          )} ${item.part}`
        : '';

    return sanitize(
      `${item.videoTitle}${part} - ${suffix}`
    );
  }

  async function probeFormats(
    item
  ) {
    if (
      !item
    ) {
      state.formats =
        [];

      renderFormats();

      return;
    }

    try {
      setStatus(
        '正在读取可用清晰度…'
      );

      const data =
        await fetchPlayData(
          item,
          127
        );

      state.formats =
        normalizeFormats(
          data
        );

      renderFormats();
    } catch (err) {
      console.warn(
        '[BiliDL] quality probe failed:',
        err
      );

      state.formats =
        [];

      renderFormats();
    }
  }

  function renderFormats() {
    const previous =
      Number(
        getDropdownValue(
          'quality'
        ) ||
        0
      );

    const formats =
      state.formats.length
        ? state.formats
        : QUALITY_FALLBACK.filter(
            item =>
              item.qn <=
              80
          );

    const preferred =
      formats.some(
        item =>
          item.qn ===
          previous
      )
        ? previous
        : formats.some(
              item =>
                item.qn ===
                80
            )
          ? 80
          : formats[0]
              ?.qn ||
            '';

    setDropdownOptions(
      'quality',

      formats.map(
        item => ({
          value:
            item.qn,

          label:
            item.label,
        })
      ),

      preferred
    );
  }

  /*
   * =========================================================
   * 列表
   * =========================================================
   */

  function updateSelectAllState() {
    const checkbox =
      $(
        `#${PANEL_ID} .tm-select-all`
      );

    if (
      !checkbox
    ) {
      return;
    }

    const visibleItems =
      getVisibleItems();

    if (
      !visibleItems.length
    ) {
      checkbox.checked =
        false;

      checkbox.indeterminate =
        false;

      checkbox.disabled =
        true;

      return;
    }

    const selectedCount =
      visibleItems.filter(
        item =>
          state.selectedKeys.has(
            item.key
          )
      ).length;

    checkbox.checked =
      selectedCount ===
      visibleItems.length;

    checkbox.indeterminate =
      selectedCount >
        0 &&
      selectedCount <
        visibleItems.length;

    checkbox.disabled =
      state.busy;
  }

  function updateSelectedCount() {
    const el =
      $(
        `#${PANEL_ID} .tm-selected-count`
      );

    if (
      el
    ) {
      el.textContent =
        `已选 ${state.selectedKeys.size}`;
    }

    updateSelectAllState();
  }

  function renderItems() {
    const list =
      $(
        `#${PANEL_ID} .tm-items`
      );

    const hint =
      $(
        `#${PANEL_ID} .tm-items-hint`
      );

    if (
      !list
    ) {
      return;
    }

    const items =
      getVisibleItems();

    const currentItem =
      getCurrentItem();

    const currentKey =
      currentItem
        ?.key ||
      '';

    list.innerHTML =
      '';

    if (
      !items.length
    ) {
      list.innerHTML =
        '<div class="tm-empty">没有匹配的视频</div>';

      if (
        hint
      ) {
        hint.textContent =
          '0 项';
      }

      updateSelectedCount();

      return;
    }

    items.forEach(
      (
        item,
        index
      ) => {
        const row =
          document.createElement(
            'div'
          );

        row.className =
          'tm-item';

        if (
          item.key ===
          currentKey
        ) {
          row.dataset.current =
            '1';
        }

        row.innerHTML = `
          <input
            class="tm-item-check"
            type="checkbox"
            data-key="${escapeHtml(
              item.key
            )}"
            ${
              state.selectedKeys.has(
                item.key
              )
                ? 'checked'
                : ''
            }
            title="勾选后可批量下载"
          >

          <span class="tm-item-index">
            ${escapeHtml(
              itemIndexText(
                item,
                index
              )
            )}
          </span>

          <span
            class="tm-item-title"
            data-key="${escapeHtml(
              item.key
            )}"
            title="单击直接下载：${escapeHtml(
              itemLabel(
                item
              )
            )}"
          >
            ${escapeHtml(
              itemLabel(
                item
              )
            )}
          </span>
        `;

        list.appendChild(
          row
        );
      }
    );

    if (
      hint
    ) {
      hint.textContent =
        state.search
          ? `${items.length}/${state.items.length} 项`
          : `${state.items.length} 项`;
    }

    updateSelectedCount();

    scrollCurrentItemToTop();
  }

  function findItem(
    key
  ) {
    return (
      state.items.find(
        item =>
          item.key ===
          key
      ) ||
      null
    );
  }

  /*
   * =========================================================
   * 直链优先
   * =========================================================
   */

  async function tryDirectMuxedDownload(
    item,
    index,
    total,
    requestedQn,
    codecPref,
    qualityLabel
  ) {
    /*
     * durl 无法精确控制 HEVC / AV1。
     * 用户明确选这两种编码时直接走 DASH。
     */
    if (
      codecPref ===
        'hevc' ||
      codecPref ===
        'av1'
    ) {
      return false;
    }

    let data;

    try {
      data =
        await fetchDirectPlayData(
          item,
          requestedQn
        );
    } catch {
      return false;
    }

    /*
     * B站降级了清晰度，不允许偷偷下载错误档位。
     */
    if (
      Number(
        data
          ?.quality ||
        0
      ) !==
      Number(
        requestedQn
      )
    ) {
      return false;
    }

    const durl =
      Array.isArray(
        data
          ?.durl
      )
        ? data.durl
        : [];

    /*
     * 多段 durl 最后仍然需要合并，
     * 这种情况继续交给 DASH。
     */
    if (
      durl.length !==
      1
    ) {
      return false;
    }

    const directCodecId =
      Number(
        data
          ?.video_codecid ||
        0
      );

    if (
      codecPref ===
        'avc' &&
      directCodecId &&
      directCodecId !==
        7
    ) {
      return false;
    }

    const entry =
      durl[0];

    const extension =
      directFileExtension(
        data,
        entry
      );

    const pseudoStream = {
      codecid:
        directCodecId ||
        7,
    };

    const outputName =
      buildBaseName(
        item,
        qualityLabel,
        pseudoStream
      );

    setStatus(
      `[${index}/${total}] 直链下载 ${qualityLabel} · 无需合流`
    );

    await downloadDirectEntry(
      entry,

      `${outputName}.${extension}`,

      (
        loaded,
        totalBytes
      ) => {
        const taskProgress =
          totalBytes >
          0
            ? loaded /
              totalBytes
            : 0;

        const global =
          (
            (
              index -
                1
            ) +
            Math.min(
              taskProgress,
              0.995
            )
          ) /
          total *
          100;

        setProgress(
          global,

          `[${index}/${total}] ${formatBytes(
            loaded
          )}${
            totalBytes >
            0
              ? ` / ${formatBytes(
                  totalBytes
                )}`
              : ''
          }`
        );
      }
    );

    setProgress(
      index /
        total *
        100,

      `[${index}/${total}] 完成`
    );

    return true;
  }

  /*
   * =========================================================
   * 视频
   * =========================================================
   */

  async function downloadOne(
    item,
    index,
    total,
    options = {}
  ) {
    const requestedQn =
      Number(
        options
          .requestedQn ??
        getSelectedQn()
      );

    const codecPref =
      options
        .codecPref ||
      getSelectedCodec();

    const qualityLabel =
      options
        .qualityLabel ||
      getDropdownRoot(
        'quality'
      )
        ?.querySelector(
          '.tm-select-label'
        )
        ?.textContent
        ?.trim() ||
      String(
        requestedQn
      );

    if (
      !requestedQn
    ) {
      throw new Error(
        '请选择清晰度'
      );
    }

    setStatus(
      `[${index}/${total}] 正在解析：${itemLabel(
        item
      )}`
    );

    setProgress(
      (
        index -
        1
      ) /
        total *
        100,

      `[${index}/${total}] 解析`
    );

    /*
     * 所有画质都先试一次完整直链。
     *
     * 能得到单文件且画质完全匹配，
     * 就不加载 FFmpeg。
     */
    const directDone =
      await tryDirectMuxedDownload(
        item,
        index,
        total,
        requestedQn,
        codecPref,
        qualityLabel
      );

    if (
      directDone
    ) {
      return;
    }

    const data =
      options
        .playData ||
      await fetchPlayData(
        item,
        requestedQn
      );

    if (
      !data
        ?.dash
    ) {
      throw new Error(
        '当前视频没有可用的 DASH 视频流。'
      );
    }

    const video =
      pickExactVideo(
        data,
        requestedQn,
        codecPref
      );

    const audio =
      pickAudio(
        data
      );

    const fps =
      frameRateName(
        video
      );

    const codec =
      codecName(
        video
          .codecid
      );

    const outputName =
      buildBaseName(
        item,
        qualityLabel,
        video
      );

    setStatus(
      `[${index}/${total}] DASH 下载 ${qualityLabel}${
        fps
          ? ` · ${fps}`
          : ''
      } · ${codec}`
    );

    let videoLoaded =
      0;

    let audioLoaded =
      0;

    let videoTotal =
      0;

    let audioTotal =
      0;

    const updateProgress =
      () => {
        const loaded =
          videoLoaded +
          audioLoaded;

        const all =
          videoTotal +
          audioTotal;

        const taskProgress =
          all >
          0
            ? loaded /
              all
            : 0;

        const global =
          (
            (
              index -
                1
            ) +
            Math.min(
              taskProgress,
              0.94
            )
          ) /
          total *
          100;

        setProgress(
          global,

          `[${index}/${total}] ${formatBytes(
            loaded
          )}${
            all >
            0
              ? ` / ${formatBytes(
                  all
                )}`
              : ''
          }`
        );
      };

    const videoPromise =
      requestStreamBuffer(
        video,

        (
          loaded,
          totalBytes
        ) => {
          videoLoaded =
            loaded;

          videoTotal =
            totalBytes ||
            videoTotal;

          updateProgress();
        }
      );

    const audioPromise =
      audio
        ? requestStreamBuffer(
            audio,

            (
              loaded,
              totalBytes
            ) => {
              audioLoaded =
                loaded;

              audioTotal =
                totalBytes ||
                audioTotal;

              updateProgress();
            }
          )
        : Promise.resolve(
            null
          );

    const [
      videoBuf,
      audioBuf,
    ] =
      await Promise.all(
        [
          videoPromise,
          audioPromise,
        ]
      );

    setStatus(
      `[${index}/${total}] 下载完成，正在无损合流…`
    );

    await muxAndSave(
      videoBuf,
      audioBuf,
      outputName
    );

    setProgress(
      index /
        total *
        100,

      `[${index}/${total}] 完成`
    );
  }

  /*
   * =========================================================
   * 音频
   * =========================================================
   */

  async function downloadAudioOne(
    item,
    index,
    total
  ) {
    setStatus(
      `[${index}/${total}] 正在解析音频：${itemLabel(
        item
      )}`
    );

    setProgress(
      (
        index -
        1
      ) /
        total *
        100,

      `[${index}/${total}] 解析音频`
    );

    const data =
      await fetchPlayData(
        item,
        80
      );

    if (
      !data
        ?.dash
    ) {
      throw new Error(
        '当前视频没有DASH音频流。'
      );
    }

    const audio =
      pickAudio(
        data
      );

    if (
      !audio
    ) {
      throw new Error(
        '当前视频没有可下载的音频流。'
      );
    }

    const codec =
      audioCodecName(
        audio
      );

    const bandwidth =
      Number(
        audio
          .bandwidth ||
        0
      );

    const bitrate =
      bandwidth >
      0
        ? `${Math.round(
            bandwidth /
            1000
          )}kbps`
        : '';

    setStatus(
      `[${index}/${total}] 下载音频${
        bitrate
          ? ` · ${bitrate}`
          : ''
      } · ${codec}`
    );

    const audioBuf =
      await requestStreamBuffer(
        audio,

        (
          loaded,
          totalBytes
        ) => {
          const progress =
            totalBytes >
            0
              ? loaded /
                totalBytes
              : 0;

          const global =
            (
              (
                index -
                  1
              ) +
              Math.min(
                progress,
                0.99
              )
            ) /
            total *
            100;

          setProgress(
            global,

            `[${index}/${total}] ${formatBytes(
              loaded
            )}${
              totalBytes >
              0
                ? ` / ${formatBytes(
                    totalBytes
                  )}`
                : ''
            }`
          );
        }
      );

    const extension =
      audioFileExtension(
        audio
      );

    const mime =
      audio
        .mimeType ||
      audio
        .mime_type ||
      (
        extension ===
        'webm'
          ? 'audio/webm'
          : 'audio/mp4'
      );

    const outputName =
      buildAudioBaseName(
        item,
        audio
      );

    saveBlob(
      new Blob(
        [
          audioBuf,
        ],
        {
          type:
            mime,
        }
      ),

      `${outputName}.${extension}`
    );

    setProgress(
      index /
        total *
        100,

      `[${index}/${total}] 音频完成`
    );
  }

  /*
   * =========================================================
   * 弹幕 XML / ASS
   * =========================================================
   */

  async function fetchDanmakuXml(
    item
  ) {
    if (
      !item
        ?.cid
    ) {
      throw new Error(
        '当前条目没有 CID，无法读取弹幕。'
      );
    }

    const xml =
      await requestTextUrl(
        `https://comment.bilibili.com/${encodeURIComponent(
          String(
            item.cid
          )
        )}.xml`
      );

    if (
      !xml
    ) {
      throw new Error(
        '没有读取到弹幕 XML。'
      );
    }

    return xml;
  }

  function assTime(
    seconds
  ) {
    const value =
      Math.max(
        0,
        Number(
          seconds
        ) ||
        0
      );

    const h =
      Math.floor(
        value /
        3600
      );

    const m =
      Math.floor(
        (
          value %
          3600
        ) /
        60
      );

    const s =
      Math.floor(
        value %
        60
      );

    const cs =
      Math.floor(
        (
          value -
          Math.floor(
            value
          )
        ) *
        100
      );

    return `${h}:${pad(
      m
    )}:${pad(
      s
    )}.${pad(
      cs
    )}`;
  }

  function assColor(
    decimalColor
  ) {
    const value =
      Math.max(
        0,
        Math.min(
          0xffffff,
          Number(
            decimalColor
          ) ||
          0xffffff
        )
      );

    const r =
      (
        value >>
        16
      ) &
      0xff;

    const g =
      (
        value >>
        8
      ) &
      0xff;

    const b =
      value &
      0xff;

    return `&H00${b
      .toString(16)
      .padStart(
        2,
        '0'
      )}${g
      .toString(16)
      .padStart(
        2,
        '0'
      )}${r
      .toString(16)
      .padStart(
        2,
        '0'
      )}&`;
  }

  function assEscapeText(
    text
  ) {
    return String(
      text ||
      ''
    )
      .replace(
        /\\/g,
        '\\\\'
      )
      .replace(
        /\{/g,
        '\\{'
      )
      .replace(
        /\}/g,
        '\\}'
      )
      .replace(
        /\r?\n/g,
        '\\N'
      );
  }

  function estimateDanmakuWidth(
    text,
    fontSize
  ) {
    let units =
      0;

    for (
      const char
      of String(
        text ||
        ''
      )
    ) {
      units +=
        /[\u0000-\u00ff]/.test(
          char
        )
          ? 0.56
          : 1;
    }

    return Math.max(
      fontSize *
        2,

      units *
        fontSize *
        0.98
    );
  }

  function convertDanmakuXmlToAss(
    xml,
    title
  ) {
    const doc =
      new DOMParser()
        .parseFromString(
          xml,
          'application/xml'
        );

    if (
      doc.querySelector(
        'parsererror'
      )
    ) {
      throw new Error(
        '弹幕 XML 解析失败。'
      );
    }

    const entries = [
      ...doc.querySelectorAll(
        'd[p]'
      ),
    ]
      .map(
        node => {
          const p =
            String(
              node.getAttribute(
                'p'
              ) ||
              ''
            ).split(
              ','
            );

          return {
            time:
              Number(
                p[0]
              ) ||
              0,

            mode:
              Number(
                p[1]
              ) ||
              1,

            size:
              Number(
                p[2]
              ) ||
              25,

            color:
              Number(
                p[3]
              ) ||
              0xffffff,

            text:
              node.textContent ||
              '',
          };
        }
      )
      .filter(
        item =>
          item.text &&
          item.mode !==
            8
      )
      .sort(
        (
          a,
          b
        ) =>
          a.time -
          b.time
      );

    const width =
      1920;

    const height =
      1080;

    const scrollDuration =
      8;

    const fixedDuration =
      4;

    const laneHeight =
      54;

    const scrollFree =
      Array(
        17
      ).fill(
        0
      );

    const topFree =
      Array(
        7
      ).fill(
        0
      );

    const bottomFree =
      Array(
        7
      ).fill(
        0
      );

    const pickLane =
      (
        lanes,
        start
      ) => {
        const free =
          lanes.findIndex(
            time =>
              time <=
              start
          );

        if (
          free >=
          0
        ) {
          return free;
        }

        let best =
          0;

        for (
          let i = 1;
          i <
          lanes.length;
          i += 1
        ) {
          if (
            lanes[i] <
            lanes[best]
          ) {
            best =
              i;
          }
        }

        return best;
      };

    const events =
      [];

    for (
      const entry
      of entries
    ) {
      const start =
        entry.time;

      let end =
        start +
        scrollDuration;

      const fontSize =
        Math.max(
          24,
          Math.min(
            64,
            Math.round(
              entry.size *
              1.75
            )
          )
        );

      let tag =
        '';

      if (
        entry.mode ===
        4
      ) {
        const lane =
          pickLane(
            bottomFree,
            start
          );

        bottomFree[
          lane
        ] =
          start +
          fixedDuration;

        end =
          start +
          fixedDuration;

        tag =
          `\\an2\\pos(${width / 2},${height - 48 - lane * laneHeight})`;
      } else if (
        entry.mode ===
        5
      ) {
        const lane =
          pickLane(
            topFree,
            start
          );

        topFree[
          lane
        ] =
          start +
          fixedDuration;

        end =
          start +
          fixedDuration;

        tag =
          `\\an8\\pos(${width / 2},${48 + lane * laneHeight})`;
      } else if (
        entry.mode ===
        7
      ) {
        end =
          start +
          fixedDuration;

        tag =
          `\\an5\\pos(${width / 2},${height / 2})`;
      } else {
        const lane =
          pickLane(
            scrollFree,
            start
          );

        scrollFree[
          lane
        ] =
          start +
          scrollDuration *
            0.82;

        const y =
          48 +
          lane *
            laneHeight;

        const textWidth =
          Math.ceil(
            estimateDanmakuWidth(
              entry.text,
              fontSize
            )
          );

        if (
          entry.mode ===
          6
        ) {
          tag =
            `\\move(${-textWidth - 30},${y},${width + 30},${y})`;
        } else {
          tag =
            `\\move(${width + 30},${y},${-textWidth - 30},${y})`;
        }
      }

      events.push(
        `Dialogue: 0,${assTime(
          start
        )},${assTime(
          end
        )},Danmaku,,0,0,0,,{${tag}\\fs${fontSize}\\c${assColor(
          entry.color
        )}}${assEscapeText(
          entry.text
        )}`
      );
    }

    return [
      '[Script Info]',

      `Title: ${String(
        title ||
        'Bilibili Danmaku'
      ).replace(
        /[\r\n]+/g,
        ' '
      )}`,

      'ScriptType: v4.00+',

      'WrapStyle: 2',

      'ScaledBorderAndShadow: yes',

      `PlayResX: ${width}`,

      `PlayResY: ${height}`,

      '',

      '[V4+ Styles]',

      'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',

      'Style: Danmaku,Microsoft YaHei,48,&H00FFFFFF,&H00FFFFFF,&H00000000,&H64000000,-1,0,0,0,100,100,0,0,1,2,0,7,20,20,20,1',

      '',

      '[Events]',

      'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',

      ...events,

      '',
    ].join(
      '\n'
    );
  }

  async function downloadSubtitleOne(
    item,
    index,
    total,
    format
  ) {
    setStatus(
      `[${index}/${total}] 正在读取 ${format.toUpperCase()} 弹幕：${itemLabel(
        item
      )}`
    );

    setProgress(
      (
        index -
        1
      ) /
        total *
        100,

      `[${index}/${total}] 弹幕`
    );

    const xml =
      await fetchDanmakuXml(
        item
      );

    const baseName =
      buildPlainBaseName(
        item
      );

    if (
      format ===
      'ass'
    ) {
      const ass =
        convertDanmakuXmlToAss(
          xml,
          itemLabel(
            item
          )
        );

      saveBlob(
        new Blob(
          [
            '\ufeff',
            ass,
          ],
          {
            type:
              'text/x-ssa;charset=utf-8',
          }
        ),

        `${baseName}.ass`
      );
    } else {
      saveBlob(
        new Blob(
          [
            xml,
          ],
          {
            type:
              'application/xml;charset=utf-8',
          }
        ),

        `${baseName}.xml`
      );
    }

    setProgress(
      index /
        total *
        100,

      `[${index}/${total}] 弹幕完成`
    );
  }

  /*
   * =========================================================
   * Logo 极速下载
   * =========================================================
   */

  function quickQualityLabel(
    qn,
    data
  ) {
    return (
      normalizeFormats(
        data
      ).find(
        item =>
          item.qn ===
          Number(
            qn
          )
      )?.label ||
      QUALITY_FALLBACK.find(
        item =>
          item.qn ===
          Number(
            qn
          )
      )?.label ||
      `画质 ${qn}`
    );
  }

  function pickQuickQn(
    data
  ) {
    /*
     * 上限为 1080P60。
     */
    const maxQn =
      116;

    const available = [
      ...new Set(
        (
          data
            ?.dash
            ?.video ||
          []
        )
          .map(
            stream =>
              Number(
                stream
                  ?.id ||
                0
              )
          )
          .filter(
            qn =>
              qn >
                0 &&
              qn <=
                maxQn
          )
      ),
    ].sort(
      (
        a,
        b
      ) =>
        b -
        a
    );

    if (
      available.length
    ) {
      return available[0];
    }

    const actual =
      Number(
        data
          ?.quality ||
        0
      );

    if (
      actual >
        0 &&
      actual <=
        maxQn
    ) {
      return actual;
    }

    throw new Error(
      '没有找到不高于 1080P60 的可下载视频流。'
    );
  }

  let quickToastTimer =
    null;

  function showQuickToast(
    text,
    type = '',
    duration = 0
  ) {
    const panel =
      document.getElementById(
        PANEL_ID
      );

    if (
      !panel
    ) {
      return;
    }

    let toast =
      document.getElementById(
        `${PANEL_ID}-quick-toast`
      );

    if (
      !toast
    ) {
      toast =
        document.createElement(
          'div'
        );

      toast.id =
        `${PANEL_ID}-quick-toast`;

      document.body.appendChild(
        toast
      );
    }

    const rect =
      panel.getBoundingClientRect();

    toast.style.left =
      `${Math.max(
        8,
        Math.min(
          rect.left,
          window.innerWidth -
            338
        )
      )}px`;

    toast.style.top =
      `${Math.min(
        window.innerHeight -
          60,
        rect.bottom +
          8
      )}px`;

    toast.textContent =
      text;

    toast.dataset.type =
      type;

    toast.classList.add(
      'show'
    );

    if (
      quickToastTimer
    ) {
      clearTimeout(
        quickToastTimer
      );

      quickToastTimer =
        null;
    }

    if (
      duration >
      0
    ) {
      quickToastTimer =
        setTimeout(
          () => {
            toast.classList.remove(
              'show'
            );
          },
          duration
        );
    }
  }

  async function startQuickCurrent() {
    if (
      state.busy
    ) {
      showQuickToast(
        '已有下载任务正在进行，请勿重复点击。',
        'warn',
        2200
      );

      return;
    }

    const item =
      getCurrentItem() ||
      state.items[0];

    if (
      !item
    ) {
      showQuickToast(
        '视频仍在解析，请稍后再点 Logo。',
        'error',
        2500
      );

      return;
    }

    setBusy(
      true
    );

    const panel =
      document.getElementById(
        PANEL_ID
      );

    panel
      ?.classList
      .add(
        'quick-busy'
      );

    showQuickToast(
      '已开始解析下载，请勿重复点击…',
      'loading'
    );

    try {
      const data =
        await fetchPlayData(
          item,
          116
        );

      if (
        !data
          ?.dash
      ) {
        throw new Error(
          '当前视频没有 DASH 视频流。'
        );
      }

      const requestedQn =
        pickQuickQn(
          data
        );

      const qualityLabel =
        quickQualityLabel(
          requestedQn,
          data
        );

      showQuickToast(
        `正在下载 ${qualityLabel}，请勿重复点击。`,
        'loading'
      );

      await downloadOne(
        item,
        1,
        1,
        {
          requestedQn,

          codecPref:
            'auto',

          qualityLabel,

          playData:
            data,
        }
      );

      setStatus(
        `下载完成：${qualityLabel} · ${itemLabel(
          item
        )}`,
        'ok'
      );

      setProgress(
        100,
        '完成'
      );

      showQuickToast(
        `${qualityLabel} 下载完成。`,
        'ok',
        2800
      );
    } catch (err) {
      console.error(
        '[BiliDL] quick download failed:',
        err
      );

      setStatus(
        `极速下载失败：${
          err
            ?.message ||
          err
        }`,
        'error'
      );

      showQuickToast(
        `下载失败：${
          err
            ?.message ||
          err
        }`,
        'error',
        3500
      );
    } finally {
      panel
        ?.classList
        .remove(
          'quick-busy'
        );

      setBusy(
        false
      );
    }
  }

  /*
   * =========================================================
   * 下载入口
   * =========================================================
   */

  async function startSingle(
    item
  ) {
    if (
      state.busy ||
      !item
    ) {
      return;
    }

    setBusy(
      true
    );

    try {
      await downloadOne(
        item,
        1,
        1
      );

      setStatus(
        `下载完成：${itemLabel(
          item
        )}`,
        'ok'
      );

      setProgress(
        100,
        '完成'
      );
    } catch (err) {
      console.error(
        '[BiliDL] single download failed:',
        err
      );

      setStatus(
        `失败：${
          err
            ?.message ||
          err
        }`,
        'error'
      );
    } finally {
      setBusy(
        false
      );
    }
  }

  async function startSelected() {
    if (
      state.busy
    ) {
      return;
    }

    const items =
      selectedItems();

    if (
      !items.length
    ) {
      throw new Error(
        '请先勾选要批量下载的视频。'
      );
    }

    setBusy(
      true
    );

    let completed =
      0;

    try {
      for (
        let i = 0;
        i <
        items.length;
        i += 1
      ) {
        await downloadOne(
          items[i],
          i + 1,
          items.length
        );

        completed +=
          1;

        if (
          i <
          items.length -
            1
        ) {
          await sleep(
            250
          );
        }
      }

      setStatus(
        `全部完成：${completed}/${items.length}`,
        'ok'
      );

      setProgress(
        100,
        `完成 ${completed}/${items.length}`
      );
    } catch (err) {
      console.error(
        '[BiliDL]',
        err
      );

      setStatus(
        `失败：${
          err
            ?.message ||
          err
        }`,
        'error'
      );
    } finally {
      setBusy(
        false
      );
    }
  }

  async function startSelectedAudio() {
    if (
      state.busy
    ) {
      return;
    }

    const items =
      selectedItems();

    if (
      !items.length
    ) {
      throw new Error(
        '请先勾选要下载音频的视频。'
      );
    }

    setBusy(
      true
    );

    let completed =
      0;

    try {
      for (
        let i = 0;
        i <
        items.length;
        i += 1
      ) {
        await downloadAudioOne(
          items[i],
          i + 1,
          items.length
        );

        completed +=
          1;

        if (
          i <
          items.length -
            1
        ) {
          await sleep(
            250
          );
        }
      }

      setStatus(
        `音频全部完成：${completed}/${items.length}`,
        'ok'
      );

      setProgress(
        100,
        `音频完成 ${completed}/${items.length}`
      );
    } catch (err) {
      console.error(
        '[BiliDL] audio download failed:',
        err
      );

      setStatus(
        `音频下载失败：${
          err
            ?.message ||
          err
        }`,
        'error'
      );
    } finally {
      setBusy(
        false
      );
    }
  }

  async function startSelectedSubtitles() {
    if (
      state.busy
    ) {
      return;
    }

    const items =
      selectedItems();

    if (
      !items.length
    ) {
      throw new Error(
        '请先勾选要下载弹幕字幕的视频。'
      );
    }

    const format =
      getSelectedSubtitleFormat();

    setBusy(
      true
    );

    let completed =
      0;

    try {
      for (
        let i = 0;
        i <
        items.length;
        i += 1
      ) {
        await downloadSubtitleOne(
          items[i],
          i + 1,
          items.length,
          format
        );

        completed +=
          1;

        if (
          i <
          items.length -
            1
        ) {
          await sleep(
            120
          );
        }
      }

      setStatus(
        `${format.toUpperCase()} 弹幕全部完成：${completed}/${items.length}`,
        'ok'
      );

      setProgress(
        100,
        `弹幕 ${completed}/${items.length}`
      );
    } catch (err) {
      console.error(
        '[BiliDL] subtitle download failed:',
        err
      );

      setStatus(
        `弹幕下载失败：${
          err
            ?.message ||
          err
        }`,
        'error'
      );
    } finally {
      setBusy(
        false
      );
    }
  }

  /*
   * =========================================================
   * 拖拽 / 最小化
   * =========================================================
   */

  function pinPanelToCurrentScreenPosition(
    panel
  ) {
    const rect =
      panel.getBoundingClientRect();

    panel.style.left =
      `${rect.left}px`;

    panel.style.top =
      `${rect.top}px`;

    panel.style.right =
      'auto';
  }

  function bindDragAndMin(
    panel
  ) {
    const header =
      $(
        `#${PANEL_ID} .tm-head`
      );

    const minBtn =
      $(
        `#${PANEL_ID} .tm-min-btn`
      );

    let dragging =
      false;

    let dragMoved =
      false;

    let startX =
      0;

    let startY =
      0;

    let startLeft =
      0;

    let startTop =
      0;

    minBtn.addEventListener(
      'click',

      event => {
        event.stopPropagation();

        pinPanelToCurrentScreenPosition(
          panel
        );

        const minimized =
          panel.classList.toggle(
            'minimized'
          );

        minBtn.textContent =
          minimized
            ? '+'
            : '−';

        minBtn.title =
          minimized
            ? '展开'
            : '最小化';

        closeDropdowns();

        if (
          !minimized
        ) {
          requestAnimationFrame(
            () => {
              requestAnimationFrame(
                () => {
                  scrollCurrentItemToTop();
                }
              );
            }
          );
        }
      }
    );

    header.addEventListener(
      'mousedown',

      event => {
        if (
          event.button !==
            0 ||
          event.target.closest(
            'button'
          )
        ) {
          return;
        }

        const rect =
          panel.getBoundingClientRect();

        panel.style.left =
          `${rect.left}px`;

        panel.style.top =
          `${rect.top}px`;

        panel.style.right =
          'auto';

        dragging =
          true;

        dragMoved =
          false;

        startX =
          event.clientX;

        startY =
          event.clientY;

        startLeft =
          rect.left;

        startTop =
          rect.top;

        header.classList.add(
          'dragging'
        );

        event.preventDefault();
      }
    );

    document.addEventListener(
      'mousemove',

      event => {
        if (
          !dragging
        ) {
          return;
        }

        if (
          Math.abs(
            event.clientX -
            startX
          ) >
            3 ||
          Math.abs(
            event.clientY -
            startY
          ) >
            3
        ) {
          dragMoved =
            true;
        }

        const maxLeft =
          Math.max(
            0,
            window.innerWidth -
              panel.offsetWidth
          );

        const maxTop =
          Math.max(
            0,
            window.innerHeight -
              panel.offsetHeight
          );

        const left =
          Math.max(
            0,
            Math.min(
              maxLeft,
              startLeft +
                event.clientX -
                startX
            )
          );

        const top =
          Math.max(
            0,
            Math.min(
              maxTop,
              startTop +
                event.clientY -
                startY
            )
          );

        panel.style.left =
          `${left}px`;

        panel.style.top =
          `${top}px`;
      }
    );

    document.addEventListener(
      'mouseup',

      () => {
        if (
          !dragging
        ) {
          return;
        }

        dragging =
          false;

        header.classList.remove(
          'dragging'
        );

        if (
          dragMoved
        ) {
          panel.dataset.justDragged =
            '1';

          setTimeout(
            () => {
              delete panel
                .dataset
                .justDragged;
            },

            0
          );
        }
      }
    );
  }

  /*
   * =========================================================
   * Panel
   * =========================================================
   */

  function createPanel() {
    let panel =
      document.getElementById(
        PANEL_ID
      );

    if (
      panel
    ) {
      return panel;
    }

    panel =
      document.createElement(
        'section'
      );

    panel.id =
      PANEL_ID;

    /*
     * 默认最小化。
     */
    panel.classList.add(
      'minimized'
    );

    panel.innerHTML = `
      <div class="tm-head">

        <div class="tm-brand">

          <div class="tm-brand-line">

            <div
              class="tm-logo-host"
              role="button"
              tabindex="0"
              title="点击下载，长按拖动"
              aria-label="点击下载当前视频，长按拖动窗口"
            >

              <img
                class="tm-bili-fallback-logo"
                src="${FALLBACK_LOGO}"
                alt="bilibili"
                draggable="false"
              >

            </div>

            <div class="tm-brand-divider"></div>

            <span class="tm-brand-name">
              视频下载
            </span>

          </div>

        </div>

        <div class="tm-head-actions">

          <button
            type="button"
            class="tm-icon-btn tm-min-btn"
            title="展开"
          >
            +
          </button>

        </div>

      </div>

      <div class="tm-body">

        <div class="tm-row">

          <label>
            清晰度
          </label>

          <div
            class="tm-dropdown"
            data-name="quality"
            data-value=""
          >

            <button
              type="button"
              class="tm-select-trigger"
              aria-haspopup="listbox"
            >

              <span class="tm-select-label">
                读取中…
              </span>

              ${dropdownArrowHtml()}

            </button>

            <div
              class="tm-select-menu"
              role="listbox"
            ></div>

          </div>

        </div>

        <div class="tm-row">

          <label>
            编码
          </label>

          <div
            class="tm-dropdown"
            data-name="codec"
            data-value="auto"
          >

            <button
              type="button"
              class="tm-select-trigger"
              aria-haspopup="listbox"
            >

              <span class="tm-select-label">
                自动（优先 H.264）
              </span>

              ${dropdownArrowHtml()}

            </button>

            <div
              class="tm-select-menu"
              role="listbox"
            ></div>

          </div>

        </div>

        <div class="tm-list-head">

          <label class="tm-select-all-wrap">

            <input
              type="checkbox"
              class="tm-select-all"
            >

            <span>
              全选
            </span>

          </label>

          <div class="tm-list-tools">

            <span class="tm-items-hint">
              0 项
            </span>

            <div class="tm-search-wrap">

              <input
                class="tm-search"
                type="text"
                placeholder="搜索标题 / 分P…"
                autocomplete="off"
              >

              <button
                type="button"
                class="tm-search-toggle"
                data-action="toggle-search"
                title="搜索"
              >

                <svg
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                >
                  <circle
                    cx="11"
                    cy="11"
                    r="6.5"
                  ></circle>

                  <path
                    d="M16 16l4 4"
                  ></path>
                </svg>

              </button>

            </div>

          </div>

        </div>

        <div class="tm-items"></div>

        <div class="tm-summary">

          <span class="tm-selected-count">
            已选 0
          </span>

          <span>
            点标题可直接下载
          </span>

        </div>

        <div class="tm-download-actions">

          <button
            type="button"
            class="tm-download"
            data-action="download"
          >
            下载已勾选视频
          </button>

          <button
            type="button"
            class="tm-download"
            data-action="download-audio"
          >
            下载已勾选音频
          </button>

        </div>

        <div class="tm-subtitle-actions">

          <div
            class="tm-dropdown"
            data-name="subtitle"
            data-value="xml"
          >

            <button
              type="button"
              class="tm-select-trigger"
              aria-haspopup="listbox"
            >

              <span class="tm-select-label">
                XML 原始弹幕
              </span>

              ${dropdownArrowHtml()}

            </button>

            <div
              class="tm-select-menu"
              role="listbox"
            ></div>

          </div>

          <button
            type="button"
            class="tm-download"
            data-action="download-subtitle"
          >
            下载已勾选字幕
          </button>

        </div>

        <div class="tm-status-card">

          <div class="tm-status-line">

            <div class="tm-status">
              正在解析视频…
            </div>

            <div class="tm-progress-text">
              等待
            </div>

          </div>

          <div class="tm-progress-track">

            <div class="tm-progress-fill">
            </div>

          </div>

        </div>

      </div>
    `;

    document.body.appendChild(
      panel
    );

    bindDragAndMin(
      panel
    );

    initStaticDropdowns();

    mountOfficialLogo();

    startLogoWatcher();

    panel.addEventListener(
      'input',

      event => {
        if (
          !event.target.matches(
            '.tm-search'
          )
        ) {
          return;
        }

        state.search =
          event.target.value ||
          '';

        renderItems();
      }
    );

    panel.addEventListener(
      'change',

      event => {
        if (
          event.target.matches(
            '.tm-select-all'
          )
        ) {
          const visibleItems =
            getVisibleItems();

          if (
            event.target.checked
          ) {
            for (
              const item
              of visibleItems
            ) {
              state.selectedKeys.add(
                item.key
              );
            }
          } else {
            for (
              const item
              of visibleItems
            ) {
              state.selectedKeys.delete(
                item.key
              );
            }
          }

          renderItems();

          return;
        }

        if (
          event.target.matches(
            '.tm-item-check'
          )
        ) {
          const key =
            event.target
              .dataset
              .key;

          if (
            !key
          ) {
            return;
          }

          if (
            event.target.checked
          ) {
            state.selectedKeys.add(
              key
            );
          } else {
            state.selectedKeys.delete(
              key
            );
          }

          updateSelectedCount();
        }
      }
    );

    panel.addEventListener(
      'click',

      async event => {
        /*
         * 自定义下拉框。
         */
        const option =
          event.target.closest(
            '.tm-select-option'
          );

        if (
          option
        ) {
          const root =
            option.closest(
              '.tm-dropdown'
            );

          setDropdownValue(
            root,

            option
              .dataset
              .value,

            option
              .querySelector(
                '.tm-option-text'
              )
              ?.textContent
              ?.trim()
          );

          root.classList.remove(
            'open'
          );

          return;
        }

        const trigger =
          event.target.closest(
            '.tm-select-trigger'
          );

        if (
          trigger
        ) {
          const root =
            trigger.closest(
              '.tm-dropdown'
            );

          const opening =
            !root.classList.contains(
              'open'
            );

          closeDropdowns(
            root
          );

          root.classList.toggle(
            'open',
            opening
          );

          return;
        }

        /*
         * Logo：
         * 单击下载；
         * 拖动以后不触发。
         */
        const logo =
          event.target.closest(
            '.tm-logo-host'
          );

        if (
          logo
        ) {
          if (
            panel.dataset.justDragged ===
            '1'
          ) {
            return;
          }

          await startQuickCurrent();

          return;
        }

        /*
         * 标题下载逻辑保持不变。
         */
        const title =
          event.target.closest(
            '.tm-item-title'
          );

        if (
          title
        ) {
          await startSingle(
            findItem(
              title
                .dataset
                .key
            )
          );

          return;
        }

        const button =
          event.target.closest(
            'button[data-action]'
          );

        if (
          !button
        ) {
          return;
        }

        try {
          if (
            button
              .dataset
              .action ===
            'toggle-search'
          ) {
            const wrap =
              button.closest(
                '.tm-search-wrap'
              );

            const input =
              wrap
                ?.querySelector(
                  '.tm-search'
                );

            if (
              !wrap ||
              !input
            ) {
              return;
            }

            const opened =
              wrap.classList.toggle(
                'open'
              );

            button.classList.toggle(
              'active',
              opened
            );

            if (
              opened
            ) {
              requestAnimationFrame(
                () => {
                  input.focus();

                  input.select();
                }
              );
            } else {
              input.blur();

              if (
                input.value ||
                state.search
              ) {
                input.value =
                  '';

                state.search =
                  '';

                renderItems();
              }
            }

            return;
          }

          if (
            button
              .dataset
              .action ===
            'download'
          ) {
            await startSelected();

            return;
          }

          if (
            button
              .dataset
              .action ===
            'download-audio'
          ) {
            await startSelectedAudio();

            return;
          }

          if (
            button
              .dataset
              .action ===
            'download-subtitle'
          ) {
            await startSelectedSubtitles();
          }
        } catch (err) {
          console.error(
            '[BiliDL]',
            err
          );

          setStatus(
            `失败：${
              err
                ?.message ||
              err
            }`,
            'error'
          );
        }
      }
    );

    document.addEventListener(
      'click',

      event => {
        if (
          !event.target.closest(
            `#${PANEL_ID} .tm-dropdown`
          )
        ) {
          closeDropdowns();
        }
      }
    );

    document.addEventListener(
      'keydown',

      event => {
        if (
          event.key ===
          'Escape'
        ) {
          closeDropdowns();
        }
      }
    );

    return panel;
  }

  /*
   * =========================================================
   * 初始化
   * =========================================================
   */

  async function initPage(
    force = false
  ) {
    if (
      state.busy &&
      !force
    ) {
      return;
    }

    const seq =
      ++state.initSeq;

    createPanel();

    mountOfficialLogo();

    setStatus(
      '正在快速解析合集 / 分P…'
    );

    setProgress(
      0,
      '解析中'
    );

    const result =
      await parseResourcesFast();

    if (
      seq !==
      state.initSeq
    ) {
      return;
    }

    const currentItem =
      getCurrentItem() ||
      state.items[0];

    await probeFormats(
      currentItem
    );

    const videoCount =
      new Set(
        state.items.map(
          item =>
            item.bvid
        )
      ).size;

    const description =
      state.hasCollection
        ? `${videoCount} 个视频 · ${state.items.length} 个条目`
        : state.items.length >
            1
          ? `${state.items.length} 个分P`
          : '单视频';

    setStatus(
      `解析完成 · ${description}`,
      'ok'
    );

    setProgress(
      0,
      '等待'
    );

    renderItems();

    return result;
  }

  /*
   * =========================================================
   * SPA
   * =========================================================
   */

  async function refreshForUrlChange() {
    /*
     * 如果此时正在下载，
     * 等当前任务结束后再解析新页面。
     */
    while (
      state.busy
    ) {
      await sleep(
        300
      );
    }

    await initPage();
  }

  function installSpaWatcher() {
    const fire =
      () =>
        window.dispatchEvent(
          new Event(
            'tm-bili-urlchange'
          )
        );

    for (
      const name
      of [
        'pushState',
        'replaceState',
      ]
    ) {
      const original =
        history[name];

      history[name] =
        function (
          ...args
        ) {
          const result =
            original.apply(
              this,
              args
            );

          fire();

          return result;
        };
    }

    window.addEventListener(
      'popstate',
      fire
    );

    window.addEventListener(
      'tm-bili-urlchange',

      () => {
        setTimeout(
          () => {
            if (
              location.href ===
              state.href
            ) {
              return;
            }

            state.href =
              location.href;

            refreshForUrlChange()
              .catch(
                err => {
                  setStatus(
                    `自动刷新失败：${
                      err
                        ?.message ||
                      err
                    }`,
                    'error'
                  );
                }
              );
          },

          300
        );
      }
    );

    setInterval(
      () => {
        if (
          location.href ===
          state.href
        ) {
          return;
        }

        state.href =
          location.href;

        refreshForUrlChange()
          .catch(
            err => {
              setStatus(
                `自动刷新失败：${
                  err
                    ?.message ||
                  err
                }`,
                'error'
              );
            }
          );
      },

      1000
    );
  }

  /*
   * =========================================================
   * CSS
   * =========================================================
   */

  GM_addStyle(`
    #${PANEL_ID} {
      --bili-blue:
        ${BILI_BLUE};

      --bili-blue-soft:
        rgba(
          0,
          174,
          236,
          .09
        );

      --bili-blue-selected:
        rgba(
          0,
          174,
          236,
          .13
        );

      --text:
        #18191c;

      --muted:
        #9499a0;

      --border:
        #e3e5e7;

      /*
       * 所有可见控件统一圆角。
       */
      --radius:
        12px;

      position:
        fixed;

      left:
        calc(
          50% +
          10px
        );

      right:
        auto;

      top:
        72px;

      width:
        430px;

      max-height:
        calc(
          100vh -
          92px
        );

      z-index:
        2147483646;

      box-sizing:
        border-box;

      /*
       * 自定义下拉菜单需要溢出窗口。
       */
      overflow:
        visible;

      color:
        var(
          --text
        );

      background:
        rgba(
          255,
          255,
          255,
          .985
        );

      border:
        1px solid
        rgba(
          0,
          0,
          0,
          .07
        );

      border-radius:
        var(
          --radius
        );

      box-shadow:
        0 12px 36px
        rgba(
          0,
          0,
          0,
          .14
        );

      backdrop-filter:
        blur(
          18px
        );

      -webkit-backdrop-filter:
        blur(
          18px
        );

      font:
        13px/1.45
        -apple-system,
        BlinkMacSystemFont,
        "Segoe UI",
        "Microsoft YaHei",
        sans-serif;

      transition:
        width .18s ease,
        box-shadow .18s ease;
    }

    #${PANEL_ID} * {
      box-sizing:
        border-box;
    }

    #${PANEL_ID} button,
    #${PANEL_ID} input {
      font:
        inherit;
    }

    /*
     * =====================================================
     * Header
     * =====================================================
     */

    #${PANEL_ID} .tm-head {
      height:
        76px;

      padding:
        0 13px
        0 17px;

      display:
        flex;

      align-items:
        center;

      justify-content:
        space-between;

      gap:
        16px;

      cursor:
        grab;

      user-select:
        none;

      background:
        rgba(
          255,
          255,
          255,
          .985
        );

      border-radius:
        var(
          --radius
        )
        var(
          --radius
        )
        0
        0;

      border-bottom:
        1px solid
        #f0f1f2;
    }

    #${PANEL_ID}
    .tm-head.dragging {
      cursor:
        grabbing;
    }

    #${PANEL_ID} .tm-brand {
      position:
        relative;

      width:
        230px;

      height:
        76px;

      flex:
        0 0 230px;
    }

    #${PANEL_ID} .tm-brand-line {
      position:
        absolute;

      left:
        0;

      top:
        50%;

      width:
        100%;

      height:
        30px;

      transform:
        translateY(
          -50%
        );

      display:
        flex;

      align-items:
        center;

      gap:
        11px;
    }

    /*
     * Logo：
     * 不再有任何 hover / focus 蓝色高亮。
     */
    #${PANEL_ID} .tm-logo-host {
      width:
        78px;

      height:
        30px;

      flex:
        0 0 78px;

      display:
        flex;

      align-items:
        center;

      justify-content:
        flex-start;

      overflow:
        hidden;

      color:
        var(
          --bili-blue
        );

      cursor:
        pointer;

      background:
        transparent !important;

      border:
        none;

      border-radius:
        0;

      outline:
        none !important;

      box-shadow:
        none !important;

      transition:
        opacity .15s ease;
    }

    #${PANEL_ID}
    .tm-logo-host:hover,

    #${PANEL_ID}
    .tm-logo-host:focus,

    #${PANEL_ID}
    .tm-logo-host:focus-visible,

    #${PANEL_ID}
    .tm-logo-host:active {
      background:
        transparent !important;

      outline:
        none !important;

      box-shadow:
        none !important;
    }

    #${PANEL_ID}
    .tm-head.dragging
    .tm-logo-host {
      cursor:
        grabbing;
    }

    #${PANEL_ID}
    .quick-busy
    .tm-logo-host,

    #${PANEL_ID}.quick-busy
    .tm-logo-host {
      opacity:
        .48;

      cursor:
        wait;
    }

    #${PANEL_ID}
    .tm-logo-host.is-svg
    .tm-bili-official-svg {
      display:
        block !important;

      width:
        78px !important;

      height:
        30px !important;

      max-width:
        78px !important;

      max-height:
        30px !important;

      margin:
        0 !important;

      padding:
        0 !important;

      flex:
        none !important;

      color:
        var(
          --bili-blue
        ) !important;
    }

    #${PANEL_ID}
    .tm-logo-host.is-svg
    .tm-bili-official-svg path,

    #${PANEL_ID}
    .tm-logo-host.is-svg
    .tm-bili-official-svg use,

    #${PANEL_ID}
    .tm-logo-host.is-svg
    .tm-bili-official-svg polygon {
      fill:
        var(
          --bili-blue
        ) !important;

      color:
        var(
          --bili-blue
        ) !important;
    }

    #${PANEL_ID} .tm-bili-fallback-logo {
      display:
        block;

      width:
        29px;

      height:
        29px;

      object-fit:
        contain;
    }

    #${PANEL_ID} .tm-brand-divider {
      width:
        1px;

      height:
        19px;

      flex:
        0 0 1px;

      margin:
        0 1px;

      background:
        var(
          --border
        );
    }

    #${PANEL_ID} .tm-brand-name {
      flex:
        0 0 auto;

      color:
        var(
          --text
        );

      font-size:
        18px;

      line-height:
        30px;

      font-weight:
        700;

      letter-spacing:
        -.25px;

      white-space:
        nowrap;
    }

    #${PANEL_ID} .tm-head-actions {
      flex:
        0 0 auto;

      display:
        flex;

      align-items:
        center;
    }

    #${PANEL_ID} .tm-icon-btn {
      width:
        36px;

      height:
        36px;

      flex:
        0 0 36px;

      padding:
        0;

      display:
        grid;

      place-items:
        center;

      border:
        1px solid
        var(
          --border
        );

      border-radius:
        var(
          --radius
        );

      color:
        #61666d;

      background:
        #fff;

      outline:
        none;

      font-size:
        20px;

      line-height:
        1;

      cursor:
        pointer;

      transition:
        border-color .15s ease,
        color .15s ease,
        background .15s ease,
        transform .1s ease;
    }

    #${PANEL_ID}
    .tm-icon-btn:hover:not(:disabled) {
      color:
        var(
          --bili-blue
        );

      border-color:
        rgba(
          0,
          174,
          236,
          .44
        );

      background:
        var(
          --bili-blue-soft
        );
    }

    #${PANEL_ID}
    .tm-icon-btn:active:not(:disabled) {
      transform:
        scale(
          .95
        );
    }

    /*
     * =====================================================
     * 最小化
     * =====================================================
     */

    #${PANEL_ID}.minimized {
      width:
        150px;

      box-shadow:
        0 9px 30px
        rgba(
          0,
          0,
          0,
          .13
        );
    }

    #${PANEL_ID}.minimized .tm-body {
      display:
        none;
    }

    #${PANEL_ID}.minimized .tm-head {
      height:
        70px;

      padding:
        0 12px
        0 14px;

      gap:
        5px;

      border-radius:
        var(
          --radius
        );

      border-bottom-color:
        transparent;
    }

    #${PANEL_ID}.minimized .tm-brand {
      width:
        78px;

      height:
        70px;

      flex:
        0 0 78px;
    }

    #${PANEL_ID}.minimized .tm-brand-line {
      width:
        78px;
    }

    #${PANEL_ID}.minimized .tm-brand-divider,

    #${PANEL_ID}.minimized .tm-brand-name {
      display:
        none;
    }

    #${PANEL_ID}.minimized .tm-icon-btn {
      width:
        34px;

      height:
        34px;

      flex-basis:
        34px;
    }

    /*
     * =====================================================
     * Body
     * =====================================================
     */

    #${PANEL_ID} .tm-body {
      padding:
        12px 15px
        14px;

      display:
        flex;

      flex-direction:
        column;

      gap:
        9px;

      max-height:
        calc(
          100vh -
          178px
        );

      background:
        rgba(
          255,
          255,
          255,
          .985
        );

      border-radius:
        0
        0
        var(
          --radius
        )
        var(
          --radius
        );
    }

    #${PANEL_ID} .tm-row {
      display:
        grid;

      grid-template-columns:
        88px
        1fr;

      align-items:
        center;

      gap:
        9px;
    }

    #${PANEL_ID} .tm-row label {
      color:
        #61666d;

      font-size:
        14px;
    }

    /*
     * =====================================================
     * 自定义下拉
     * =====================================================
     */

    #${PANEL_ID} .tm-dropdown {
      position:
        relative;

      min-width:
        0;
    }

    #${PANEL_ID} .tm-select-trigger {
      width:
        100%;

      height:
        42px;

      padding:
        0 13px;

      display:
        flex;

      align-items:
        center;

      justify-content:
        space-between;

      gap:
        12px;

      border:
        1px solid
        var(
          --border
        );

      border-radius:
        var(
          --radius
        );

      color:
        var(
          --text
        );

      background:
        #fff;

      outline:
        none;

      cursor:
        pointer;

      text-align:
        left;

      transition:
        border-color .15s ease,
        box-shadow .15s ease,
        background .15s ease;
    }

    #${PANEL_ID}
    .tm-select-trigger:hover:not(:disabled) {
      border-color:
        #c9ccd0;
    }

    #${PANEL_ID} .tm-select-label {
      min-width:
        0;

      overflow:
        hidden;

      white-space:
        nowrap;

      text-overflow:
        ellipsis;
    }

    /*
     * 箭头永远固定朝下。
     * 打开和关闭均不旋转、不移动。
     */
    #${PANEL_ID} .tm-select-arrow {
      width:
        18px;

      height:
        18px;

      flex:
        0 0 18px;

      display:
        grid;

      place-items:
        center;

      color:
        #61666d;

      transform:
        none !important;
    }

    #${PANEL_ID} .tm-select-arrow svg {
      width:
        16px;

      height:
        16px;

      display:
        block;

      fill:
        none;

      stroke:
        currentColor;

      stroke-width:
        1.8;

      stroke-linecap:
        round;

      stroke-linejoin:
        round;
    }

    #${PANEL_ID}
    .tm-dropdown.open
    .tm-select-trigger {
      border-color:
        var(
          --bili-blue
        );

      box-shadow:
        0 0 0 3px
        var(
          --bili-blue-soft
        );
    }

    #${PANEL_ID}
    .tm-dropdown.open
    .tm-select-arrow {
      color:
        #61666d;

      transform:
        none !important;
    }

    /*
     * 菜单本体有内边距，
     * 每个选项之间也有 6px 真正空隙。
     */
    #${PANEL_ID} .tm-select-menu {
      position:
        absolute;

      left:
        0;

      right:
        0;

      top:
        calc(
          100% +
          7px
        );

      z-index:
        60;

      max-height:
        255px;

      padding:
        7px;

      display:
        flex;

      flex-direction:
        column;

      gap:
        6px;

      overflow-x:
        hidden;

      overflow-y:
        auto;

      opacity:
        0;

      visibility:
        hidden;

      transform:
        translateY(
          -4px
        );

      border:
        1px solid
        var(
          --border
        );

      border-radius:
        var(
          --radius
        );

      background:
        #fff;

      box-shadow:
        0 12px 30px
        rgba(
          0,
          0,
          0,
          .15
        );

      transition:
        opacity .12s ease,
        transform .12s ease,
        visibility .12s ease;
    }

    #${PANEL_ID}
    .tm-dropdown.open
    .tm-select-menu {
      opacity:
        1;

      visibility:
        visible;

      transform:
        translateY(
          0
        );
    }

    #${PANEL_ID} .tm-select-option {
      width:
        100%;

      min-height:
        40px;

      flex:
        0 0 auto;

      padding:
        0 12px;

      display:
        flex;

      align-items:
        center;

      justify-content:
        space-between;

      gap:
        10px;

      border:
        0;

      border-radius:
        var(
          --radius
        );

      color:
        var(
          --text
        );

      background:
        transparent;

      outline:
        none;

      cursor:
        pointer;

      text-align:
        left;

      transition:
        color .14s ease,
        background-color .14s ease;
    }

    #${PANEL_ID}
    .tm-select-option:hover:not(:disabled) {
      color:
        #008fc4;

      background:
        var(
          --bili-blue-soft
        );
    }

    #${PANEL_ID}
    .tm-select-option.selected {
      color:
        #008fc4;

      font-weight:
        600;

      background:
        var(
          --bili-blue-selected
        );
    }

    #${PANEL_ID} .tm-option-text {
      min-width:
        0;

      overflow:
        hidden;

      white-space:
        nowrap;

      text-overflow:
        ellipsis;
    }

    #${PANEL_ID} .tm-option-check {
      flex:
        0 0 auto;

      opacity:
        0;

      color:
        var(
          --bili-blue
        );

      font-size:
        18px;

      font-weight:
        800;
    }

    #${PANEL_ID}
    .tm-select-option.selected
    .tm-option-check {
      opacity:
        1;
    }

    /*
     * =====================================================
     * 列表顶部
     * =====================================================
     */

    #${PANEL_ID} .tm-list-head {
      min-height:
        32px;

      display:
        flex;

      align-items:
        center;

      justify-content:
        space-between;

      gap:
        10px;
    }

    #${PANEL_ID} .tm-list-tools {
      min-width:
        0;

      display:
        flex;

      align-items:
        center;

      justify-content:
        flex-end;

      gap:
        7px;
    }

    #${PANEL_ID} .tm-search-wrap {
      min-width:
        0;

      display:
        flex;

      align-items:
        center;

      justify-content:
        flex-end;

      gap:
        7px;
    }

    #${PANEL_ID} .tm-search {
      width:
        0;

      min-width:
        0;

      height:
        36px;

      padding:
        0;

      opacity:
        0;

      pointer-events:
        none;

      border:
        1px solid
        transparent;

      border-radius:
        var(
          --radius
        );

      color:
        var(
          --text
        );

      background:
        #fff;

      outline:
        none;

      transition:
        width .18s ease,
        padding .18s ease,
        opacity .12s ease,
        border-color .12s ease,
        box-shadow .15s ease;
    }

    #${PANEL_ID}
    .tm-search-wrap.open
    .tm-search {
      width:
        180px;

      padding:
        0 10px;

      opacity:
        1;

      pointer-events:
        auto;

      border-color:
        var(
          --border
        );
    }

    #${PANEL_ID} .tm-search:focus {
      border-color:
        var(
          --bili-blue
        );

      box-shadow:
        0 0 0 3px
        var(
          --bili-blue-soft
        );
    }

    #${PANEL_ID} .tm-search-toggle {
      width:
        36px;

      height:
        36px;

      flex:
        0 0 36px;

      padding:
        0;

      display:
        grid;

      place-items:
        center;

      border:
        1px solid
        var(
          --border
        );

      border-radius:
        var(
          --radius
        );

      color:
        #61666d;

      background:
        #fff;

      outline:
        none;

      cursor:
        pointer;
    }

    #${PANEL_ID}
    .tm-search-toggle:hover:not(:disabled),

    #${PANEL_ID}
    .tm-search-toggle.active {
      color:
        var(
          --bili-blue
        );

      border-color:
        rgba(
          0,
          174,
          236,
          .44
        );

      background:
        var(
          --bili-blue-soft
        );
    }

    #${PANEL_ID} .tm-search-toggle svg {
      width:
        17px;

      height:
        17px;

      fill:
        none;

      stroke:
        currentColor;

      stroke-width:
        1.8;

      stroke-linecap:
        round;
    }

    #${PANEL_ID} .tm-select-all-wrap {
      display:
        inline-flex;

      align-items:
        center;

      gap:
        7px;

      color:
        #61666d;

      font-weight:
        500;

      cursor:
        pointer;

      user-select:
        none;
    }

    #${PANEL_ID} input[type="checkbox"] {
      width:
        18px;

      height:
        18px;

      margin:
        0;

      accent-color:
        var(
          --bili-blue
        );

      cursor:
        pointer;
    }

    #${PANEL_ID} .tm-items-hint {
      color:
        var(
          --muted
        );

      font-size:
        11px;
    }

    /*
     * =====================================================
     * 视频列表
     * =====================================================
     */

    #${PANEL_ID} .tm-items {
      position:
        relative;

      min-height:
        0;

      max-height:
        320px;

      overflow:
        auto;

      border:
        1px solid
        var(
          --border
        );

      border-radius:
        var(
          --radius
        );

      background:
        #f7f8f9;

      scroll-behavior:
        auto;
    }

    #${PANEL_ID} .tm-items::-webkit-scrollbar,

    #${PANEL_ID} .tm-select-menu::-webkit-scrollbar {
      width:
        6px;
    }

    #${PANEL_ID} .tm-items::-webkit-scrollbar-thumb,

    #${PANEL_ID} .tm-select-menu::-webkit-scrollbar-thumb {
      border-radius:
        999px;

      background:
        #d3d6d9;
    }

    #${PANEL_ID} .tm-item {
      min-height:
        46px;

      padding:
        6px 10px;

      display:
        grid;

      grid-template-columns:
        20px
        max-content
        minmax(
          0,
          1fr
        );

      align-items:
        center;

      column-gap:
        7px;

      background:
        transparent;

      transition:
        background-color .2s ease;
    }

    #${PANEL_ID}
    .tm-item + .tm-item {
      border-top:
        1px solid
        #e9eaec;
    }

    #${PANEL_ID}
    .tm-item:hover {
      background:
        #fff;
    }

    #${PANEL_ID} .tm-item-index {
      color:
        var(
          --muted
        );

      white-space:
        nowrap;

      font-variant-numeric:
        tabular-nums;

      transition:
        color .2s ease;
    }

    #${PANEL_ID} .tm-item-title {
      min-width:
        0;

      padding:
        6px 7px;

      overflow:
        hidden;

      white-space:
        nowrap;

      text-overflow:
        ellipsis;

      border-radius:
        var(
          --radius
        );

      color:
        var(
          --text
        );

      cursor:
        pointer;

      transition:
        color .2s ease,
        background-color .2s ease;
    }

    #${PANEL_ID}
    .tm-item-title:hover,

    #${PANEL_ID}
    .tm-item.tm-current-flash
    .tm-item-title {
      color:
        var(
          --bili-blue
        );

      background:
        var(
          --bili-blue-soft
        );
    }

    #${PANEL_ID}
    .tm-item.tm-current-flash
    .tm-item-index {
      color:
        var(
          --bili-blue
        );
    }

    #${PANEL_ID} .tm-empty {
      padding:
        20px;

      color:
        var(
          --muted
        );

      text-align:
        center;
    }

    #${PANEL_ID} .tm-summary {
      display:
        flex;

      align-items:
        center;

      justify-content:
        space-between;

      color:
        var(
          --muted
        );

      font-size:
        11px;
    }

    /*
     * =====================================================
     * 下载
     * =====================================================
     */

    #${PANEL_ID} .tm-download-actions,

    #${PANEL_ID} .tm-subtitle-actions {
      display:
        grid;

      grid-template-columns:
        minmax(
          0,
          1fr
        )
        minmax(
          0,
          1fr
        );

      gap:
        8px;
    }

    #${PANEL_ID} .tm-subtitle-actions {
      grid-template-columns:
        166px
        minmax(
          0,
          1fr
        );
    }

    #${PANEL_ID} .tm-download {
      width:
        100%;

      min-height:
        42px;

      padding:
        0 10px;

      border:
        0;

      border-radius:
        var(
          --radius
        );

      color:
        #fff;

      background:
        linear-gradient(
          135deg,
          #00aeec 0%,
          #22bce9 100%
        );

      font-weight:
        700;

      cursor:
        pointer;

      box-shadow:
        0 5px 15px
        rgba(
          0,
          174,
          236,
          .18
        );

      transition:
        filter .15s ease,
        transform .1s ease,
        box-shadow .15s ease;
    }

    #${PANEL_ID}
    .tm-download:hover:not(:disabled) {
      filter:
        brightness(
          1.055
        );

      box-shadow:
        0 6px 18px
        rgba(
          0,
          174,
          236,
          .26
        );
    }

    #${PANEL_ID}
    .tm-download:active:not(:disabled) {
      transform:
        scale(
          .985
        );
    }

    #${PANEL_ID} button:disabled,

    #${PANEL_ID} input:disabled {
      opacity:
        .52;

      cursor:
        not-allowed;
    }

    /*
     * =====================================================
     * 状态 / 进度
     * =====================================================
     */

    #${PANEL_ID} .tm-status-card {
      padding:
        9px 10px
        7px;

      border-radius:
        var(
          --radius
        );

      background:
        #f6f7f8;
    }

    #${PANEL_ID} .tm-status-line {
      min-width:
        0;

      display:
        flex;

      align-items:
        center;

      justify-content:
        space-between;

      gap:
        8px;
    }

    #${PANEL_ID} .tm-status {
      min-width:
        0;

      flex:
        1 1 auto;

      overflow:
        hidden;

      color:
        #61666d;

      white-space:
        nowrap;

      text-overflow:
        ellipsis;
    }

    #${PANEL_ID}
    .tm-status[data-type="ok"] {
      color:
        #008fc4;
    }

    #${PANEL_ID}
    .tm-status[data-type="error"] {
      color:
        #d64242;
    }

    #${PANEL_ID} .tm-progress-text {
      flex:
        0 0 auto;

      max-width:
        150px;

      overflow:
        hidden;

      color:
        var(
          --muted
        );

      font-size:
        10.5px;

      white-space:
        nowrap;

      text-overflow:
        ellipsis;

      text-align:
        right;
    }

    #${PANEL_ID} .tm-progress-track {
      height:
        3px;

      margin-top:
        6px;

      overflow:
        hidden;

      border-radius:
        999px;

      background:
        var(
          --border
        );
    }

    #${PANEL_ID} .tm-progress-fill {
      width:
        0;

      height:
        100%;

      border-radius:
        999px;

      background:
        var(
          --bili-blue
        );

      transition:
        width .18s ease;
    }

    /*
     * =====================================================
     * Logo 下载提示
     * =====================================================
     */

    #${PANEL_ID}-quick-toast {
      position:
        fixed;

      z-index:
        2147483647;

      max-width:
        330px;

      padding:
        10px 13px;

      opacity:
        0;

      visibility:
        hidden;

      transform:
        translateY(
          -5px
        );

      border:
        1px solid
        rgba(
          0,
          174,
          236,
          .22
        );

      border-radius:
        12px;

      color:
        #0078a8;

      background:
        rgba(
          255,
          255,
          255,
          .985
        );

      box-shadow:
        0 10px 28px
        rgba(
          0,
          0,
          0,
          .16
        );

      font:
        13px/1.45
        -apple-system,
        BlinkMacSystemFont,
        "Segoe UI",
        "Microsoft YaHei",
        sans-serif;

      transition:
        opacity .14s ease,
        transform .14s ease,
        visibility .14s ease;

      pointer-events:
        none;
    }

    #${PANEL_ID}-quick-toast.show {
      opacity:
        1;

      visibility:
        visible;

      transform:
        translateY(
          0
        );
    }

    #${PANEL_ID}-quick-toast[data-type="error"] {
      color:
        #d64242;

      border-color:
        rgba(
          214,
          66,
          66,
          .22
        );
    }

    #${PANEL_ID}-quick-toast[data-type="ok"] {
      color:
        #008fc4;
    }

    #${PANEL_ID}-quick-toast[data-type="warn"] {
      color:
        #a66a00;

      border-color:
        rgba(
          166,
          106,
          0,
          .20
        );
    }

    @media (
      max-width:
      900px
    ) {
      #${PANEL_ID} {
        left:
          8px;

        right:
          auto;

        top:
          62px;

        width:
          min(
            430px,
            calc(
              100vw -
              16px
            )
          );
      }

      #${PANEL_ID}.minimized {
        width:
          min(
            150px,
            calc(
              100vw -
              16px
            )
          );
      }
    }
  `);

  createPanel();

  installSpaWatcher();

  initPage()
    .catch(
      err => {
        console.error(
          '[BiliDL] init failed:',
          err
        );

        setStatus(
          `初始化失败：${
            err
              ?.message ||
            err
          }`,
          'error'
        );
      }
    );
})();