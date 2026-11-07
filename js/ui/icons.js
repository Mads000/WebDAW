// Eigener, einheitlicher Icon-Satz (20×20, Linienstil) statt systemabhängiger Emoji.
'use strict';
(() => {
    const P = {
        play: { fill: 1, d: 'M6 3.8v12.4a.6.6 0 0 0 .9.5l10-6.2a.6.6 0 0 0 0-1L6.900 3.300a.6.6 0 0 0-.9.5z' },
        pause: { fill: 1, d: 'M5 3.500h3.500v13H5zM11.500 3.500H15v13h-3.500z' },
        stop: { fill: 1, d: 'M4.500 4.500h11v11h-11z' },
        record: { fill: 1, d: 'M10 4a6 6 0 1 0 0 12 6 6 0 0 0 0-12z' },
        rewind: { fill: 1, d: 'M4 4h2.200v12H4zM16.500 4.300v11.400a.5.5 0 0 1-.8.4L7.500 10.400a.5.5 0 0 1 0-.8l8.200-5.700a.5.5 0 0 1 .8.4z' },
        undo: 'M7.500 4.500 4 8l3.500 3.500M4.500 8H12a4 4 0 0 1 0 8H8.500',
        redo: 'M12.500 4.500 16 8l-3.500 3.500M15.500 8H8a4 4 0 0 0 0 8h3.500',
        cycle: 'M4 9V8a3 3 0 0 1 3-3h8.500M13 2.500 15.500 5 13 7.500M16 11v1a3 3 0 0 1-3 3H4.500M7 12.500 4.500 15 7 17.500',
        punch: 'M3 10h3M14 10h3M6 5v10M14 5v10M9 10h2',
        metronome: 'M7.500 3h5l3 14H4.500zM10 13l4.500-7.500M6 13.500h8',
        countin: 'M4 16V8M8 16V5M12 16v-6M16 16V4',
        keysnap: 'M3 5h14v11H3zM7 5v6.500M10 5v6.500M13 5v6.500M7 11.500V16M10 11.500V16M13 11.500V16',
        library: 'M3 4v12M7 4v12M11 4.300l4 11.400M4.500 4 M11 4.300l2-.7 4 11.400-2 .7',
        knob: 'M10 16.500a6.500 6.500 0 1 0 0-13 6.500 6.500 0 0 0 0 13zM10 10l2.800-2.800',
        roll: 'M3 4h14v12H3zM3 8h14M3 12h14M6 6h4M9 10h5M5 14h3',
        mixer: 'M5 3v14M10 3v14M15 3v14M3 12.500h4M8 6.500h4M13 10.500h4',
        scissors: 'M6 7.500a2.300 2.300 0 1 0 0-4.600 2.300 2.300 0 0 0 0 4.600zM6 17a2.300 2.300 0 1 0 0-4.600A2.300 2.300 0 0 0 6 17zM7.800 6.500 17 15M7.800 13.500 17 5',
        copy: 'M7 7h9.500v9.500H7zM13 7V3.500H3.500V13H7',
        trash: 'M4 5.500h12M8 5.500V3.500h4v2M5.500 5.500l.8 11h7.400l.8-11M8.500 8.500v5M11.500 8.500v5',
        magnet: 'M4 4h3v6.500a3 3 0 0 0 6 0V4h3v6.500a6 6 0 0 1-12 0zM4 7h3M13 7h3',
        mic: 'M10 2.500a2.500 2.500 0 0 0-2.500 2.500v5a2.500 2.500 0 0 0 5 0V5A2.500 2.500 0 0 0 10 2.500zM5 9.500a5 5 0 0 0 10 0M10 14.500v3M7 17.500h6',
        guitar: 'M16.500 3.500l-6 6M13.500 2.500l4 4M9.800 8.700c-1.300-.8-2.800-.7-3.600.4-.5.6-.5 1.300-.9 1.700-.5.400-1.200.300-1.900 1-1.200 1.200-1 3 .4 4.400s3.200 1.600 4.400.4c.7-.7.6-1.400 1-1.900.4-.4 1.100-.4 1.700-.9 1.100-.8 1.200-2.300.4-3.600zM7.200 12.800h0',
        bass: 'M17 2.800 10.300 9.500M14.500 1.800l3.700 3.700M9.900 9c-1-.5-2.100-.3-2.800.5-.5.6-.5 1.200-.9 1.500-.5.300-1 .2-1.500.7-1 1-.9 2.400.3 3.600s2.700 1.300 3.700.3c.5-.5.4-1 .7-1.500.3-.4 1-.4 1.500-.9.700-.7.900-1.800.5-2.700',
        uke: 'M15.500 4.500 10.500 9.500M13 3l4 4M9.500 9.200a3 3 0 0 0-4.200.3 2.800 2.800 0 0 0 .3 1.500 3.200 3.200 0 0 0-2 .7 3.100 3.100 0 0 0 4.400 4.400 3.200 3.200 0 0 0 .7-2 2.800 2.800 0 0 0 1.500.3 3 3 0 0 0 .3-4.200z',
        keys: 'M2.500 5h15v10h-15zM6.500 5v5.500M10 5v5.500M13.500 5v5.500M6.500 10.500V15M10 10.500V15M13.500 10.500V15',
        drums: 'M3 8.500c0-1.700 3.100-3 7-3s7 1.300 7 3-3.100 3-7 3-7-1.300-7-3zM3 8.500v5c0 1.700 3.100 3 7 3s7-1.300 7-3v-5M6 11v5M14 11v5M6.500 2.500l3 4M13.500 2.500l-3 4',
        synth: 'M2.500 10h2.300l1.700-5 3 10 2.800-8 1.700 3h3.500',
        strings: 'M13 2.500c-2 2-2 4-5 6.500a4 4 0 1 0 5.600 5.600c2.400-3 4.500-3 6.400-5M6 15l-3.500 3M7.500 10l4 4',
        brass: 'M3 8v4l3-.5h4c1.500 0 4 1.500 7 4V4.500c-3 2.500-5.500 4-7 4H6zM7 11.500V15',
        mallet: 'M4 16 13 7M13 3.500l3.500 3.500-2 2L11 5.500z',
        choir: 'M7 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM2 17c0-3 2.200-5 5-5s5 2 5 5M13.500 10a2.500 2.500 0 1 0 0-5M14 12.200c2.300.3 4 2.100 4 4.800',
        plus: 'M10 4v12M4 10h12',
        tuner: 'M3 15a7 7 0 0 1 14 0M10 15l3.500-6M3.500 15h13',
        more: { fill: 1, d: 'M4.500 8.500a1.500 1.500 0 1 0 0 3 1.500 1.500 0 0 0 0-3zM10 8.500a1.500 1.500 0 1 0 0 3 1.500 1.500 0 0 0 0-3zM15.500 8.500a1.500 1.500 0 1 0 0 3 1.500 1.500 0 0 0 0-3z' },
        close: 'M5 5l10 10M15 5 5 15',
        zoomIn: 'M9 15a6 6 0 1 0 0-12 6 6 0 0 0 0 12zM13.500 13.500 17 17M9 6.500v5M6.500 9h5',
        zoomOut: 'M9 15a6 6 0 1 0 0-12 6 6 0 0 0 0 12zM13.500 13.500 17 17M6.500 9h5',
        monitor: 'M3 11v-1a7 7 0 0 1 14 0v1M3 11.500h2.500V16H3zM14.500 11.500H17V16h-2.500z',
        auto: 'M2.500 14c3 0 3-8 5.500-8s2.500 5 5 5 2.500-3 4.500-3',
        loop: 'M4 9V8a3 3 0 0 1 3-3h7M12 2.500 14.500 5 12 7.500M16 11v1a3 3 0 0 1-3 3H6M8 12.500 5.500 15 8 17.500',
        wave: 'M2.500 10h1.500M6 6v8M9 3.500v13M12 7v6M15 5v10M17.500 10h0',
        file: 'M5 2.500h6.500L15.500 6.500v11H5zM11.500 2.500v4h4',
        dice: 'M4 4h12v12H4zM8 8h0M12 12h0M12 8h0M8 12h0',
    };
    const NS = 'http://www.w3.org/2000/svg';

    function icon(name) {
        const def = P[name] || P.file;
        const d = typeof def === 'string' ? def : def.d;
        const svg = document.createElementNS(NS, 'svg');
        svg.setAttribute('viewBox', '0 0 20 20');
        svg.setAttribute('class', 'ico' + (def.fill ? ' fill' : ''));
        svg.setAttribute('aria-hidden', 'true');
        const path = document.createElementNS(NS, 'path');
        path.setAttribute('d', d);
        svg.append(path);
        return svg;
    }

    const CAT_ICON = {
        Gitarren: 'guitar', Bass: 'bass', Keys: 'keys', Mallets: 'mallet', Synth: 'synth',
        Orchestral: 'strings', Britpop: 'guitar', Akustisch: 'uke', Elektronisch: 'synth',
    };

    function trackIcon(t) {
        if (t.type === 'drum') return 'drums';
        if (t.type === 'audio') return t.iconName || 'mic';
        const def = WD.instruments.INSTR[t.inst];
        if (!def) return 'keys';
        if (def.iconName) return def.iconName;
        return CAT_ICON[def.cat] || 'keys';
    }

    WD.icons = {
        icon, trackIcon, CAT_ICON,
        applyAll(root) {
            (root || document).querySelectorAll('[data-icon]').forEach(b => {
                if (!b.querySelector('svg')) b.prepend(icon(b.dataset.icon));
            });
        },
    };
})();
