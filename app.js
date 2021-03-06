var handler = new OpenmixApplication({
    providers: {
        'cloudflare': 'cdn.jsdelivr.net.cdn.cloudflare.net',
        'maxcdn': 'jsdelivr3.dak.netdna-cdn.com',
        'exvm-sg': 'exvm-sg.jsdelivr.net',
        'tm-mg': 'tm-mg.jsdelivr.net',
        'keycdn': 'jsdelivr-cb7.kxcdn.com'
    },
    countryMapping: {
        'CN': [ 'exvm-sg', 'cloudflare', 'maxcdn', 'keycdn' ],
        'HK': [ 'exvm-sg', 'cloudflare', 'maxcdn', 'keycdn' ],
        'ID': [ 'exvm-sg', 'cloudflare', 'maxcdn', 'keycdn' ],
        'IN': [ 'exvm-sg', 'cloudflare', 'maxcdn', 'keycdn' ],
        'KR': [ 'exvm-sg', 'cloudflare', 'maxcdn', 'keycdn' ],
        'MY': [ 'exvm-sg', 'cloudflare', 'maxcdn', 'keycdn' ],
        'SG': [ 'exvm-sg', 'cloudflare', 'maxcdn', 'keycdn' ],
        'TH': [ 'exvm-sg', 'cloudflare', 'maxcdn', 'keycdn' ],
        'JP': [ 'exvm-sg', 'cloudflare', 'maxcdn', 'keycdn' ],
        'VN': [ 'exvm-sg', 'cloudflare', 'maxcdn', 'keycdn' ],
        'MG': [ 'tm-mg', 'cloudflare']
    },
    asnMapping: {
        '36114': [ 'maxcdn' ], // Las Vegas 2
        '36351': [ 'maxcdn' ], // San Jose + Washington
        '15003': [ 'maxcdn' ], // Chicago
        '8972': [ 'maxcdn' ], // Strasbourg
        '32489': [ 'cloudflare' ], // Canada
        '32613': [ 'cloudflare' ], // Canada
        '25137': [ 'cloudflare' ], // Portugal
        '58206': [ 'cloudflare' ], // Portugal
        '16265': [ 'maxcdn' ], // Amsterdam
        '30736': [ 'maxcdn' ] // Denmark
    },
    defaultProviders: [ 'maxcdn', 'cloudflare', 'keycdn' ],
    lastResortProvider: 'maxcdn',
    defaultTtl: 20,
    availabilityThresholds: {
        normal: 92,
        pingdom: 50
    },
    sonarThreshold: 0.95,
    minValidRtt: 4
});

function init(config) {
    'use strict';
    handler.doInit(config);
}

function onRequest(request, response) {
    'use strict';
    handler.handleRequest(request, response);
}

/**
 * @constructor
 * @param {{
 *      providers:!Object.<string,string>
 * }} settings
 */
function OpenmixApplication(settings) {
    'use strict';

    var aliases = Object.keys(settings.providers);

    /** @param {OpenmixConfiguration} config */
    this.doInit = function(config) {
        var i = aliases.length;
        while (i--) {
            config.requireProvider(aliases[i]);
        }
    };

    /**
     * @param {OpenmixRequest} request
     * @param {OpenmixResponse} response
     */
    this.handleRequest = function(request, response) {

        var reasons,
            candidates,
            candidateAliases,
            sonar,
            subpopulation = settings.defaultProviders,
            availabilityThreshold = settings.availabilityThresholds.normal,
            decisionAlias,
            decisionReasons = [],
            decisionTtl;

        /**
         * @param {{avail:number}} candidate
         * @param {string} alias
         */
        function filterCandidates(candidate, alias) {
            return (-1 < subpopulation.indexOf(alias))
                && (candidate.avail !== undefined)
                && (candidate.avail >= availabilityThreshold)
                && (sonar[alias] !== undefined)
                && (parseFloat(sonar[alias]) >= settings.sonarThreshold);
        }

        /**
         * @param {{http_rtt:number}} candidate
         */
        function filterInvalidRtt(candidate) {
            /* jshint camelcase:false */
            return candidate.http_rtt >= settings.minValidRtt;
            /* jshint camelcase:true */
        }

        // Application logic here
        reasons = {
            rtt: 'A',
            singleAvailableCandidate: 'D',
            noneAvailableOrNoRtt: 'E',
            missingRttForAvailableCandidates: 'F'
        };

        if (settings.countryMapping) {
            if (settings.countryMapping[request.country]) {
                subpopulation = settings.countryMapping[request.country];
            }
        }

        if (settings.asnMapping) {
            if (request.asn in settings.asnMapping) {
                subpopulation = settings.asnMapping[request.asn];
                availabilityThreshold = settings.availabilityThresholds.pingdom;
            }
        }
        //console.log('subpop: ' + JSON.stringify(subpopulation));

        sonar = request.getData('sonar');
        candidates = filterObject(request.getProbe('avail'), filterCandidates);
        //console.log('candidates: ' + JSON.stringify(candidates));
        candidates = joinObjects(candidates, request.getProbe('http_rtt'), 'http_rtt');
        //console.log('candidates (with rtt): ' + JSON.stringify(candidates));
        candidateAliases = Object.keys(candidates);

        if (1 === candidateAliases.length) {
            decisionAlias = candidateAliases[0];
            decisionReasons.push(reasons.singleAvailableCandidate);
            decisionTtl = decisionTtl || settings.defaultTtl;
        } else if (0 === candidateAliases.length) {
            decisionAlias = settings.lastResortProvider;
            decisionReasons.push(reasons.noneAvailableOrNoRtt);
            decisionTtl = decisionTtl || settings.defaultTtl;
        } else {
            candidates = filterObject(candidates, filterInvalidRtt);
            //console.log('candidates (rtt filtered): ' + JSON.stringify(candidates));
            candidateAliases = Object.keys(candidates);

            if (!candidateAliases.length) {
                decisionAlias = settings.lastResortProvider;
                decisionReasons.push(reasons.missingRttForAvailableCandidates);
                decisionTtl = decisionTtl || settings.defaultTtl;
            } else {
                decisionAlias = getLowest(candidates, 'http_rtt');
                decisionReasons.push(reasons.rtt);
                decisionTtl = decisionTtl || settings.defaultTtl;
            }
        }

        response.respond(decisionAlias, settings.providers[decisionAlias]);
        response.setReasonCode(decisionReasons.join(''));
        response.setTTL(decisionTtl);
    };

    /**
     * @param {!Object} object
     * @param {Function} filter
     */
    function filterObject(object, filter) {
        var keys = Object.keys(object),
            i = keys.length,
            key;

        while (i --) {
            key = keys[i];

            if (!filter(object[key], key)) {
                delete object[key];
            }
        }

        return object;
    }

    /**
     * @param {!Object} target
     * @param {Object} source
     * @param {string} property
     */
    function joinObjects(target, source, property) {
        var keys = Object.keys(target),
            i = keys.length,
            key;

        while (i --) {
            key = keys[i];

            if (typeof source[key] !== 'undefined' && typeof source[key][property] !== 'undefined') {
                target[key][property] = source[key][property];
            }
            else {
                delete target[key];
            }
        }

        return target;
    }

    /**
     * @param {!Object} source
     * @param {string} property
     */
    function getLowest(source, property) {
        var keys = Object.keys(source),
            i = keys.length,
            key,
            candidate,
            min = Infinity,
            value;

        while (i --) {
            key = keys[i];
            value = source[key][property];

            if (value < min) {
                candidate = key;
                min = value;
            }
        }

        return candidate;
    }
}
