// ==UserScript==
// @name        Import CD1D releases into MB
// @description Add a button on CD1D.com release pages allowing to open MusicBrainz release editor with pre-filled data for the selected release
// @namespace   http://userscripts.org/users/517952
// @include     http://cd1d.com/*/album/*
// @version     2015.06.04.0
// @downloadURL https://raw.github.com/murdos/musicbrainz-userscripts/master/cd1d_importer.user.js
// @updateURL   https://raw.github.com/murdos/musicbrainz-userscripts/master/cd1d_importer.user.js
// @require     https://ajax.googleapis.com/ajax/libs/jquery/2.1.4/jquery.min.js
// @require     https://raw.github.com/murdos/musicbrainz-userscripts/master/lib/import_functions.js
// @require     https://raw.github.com/murdos/musicbrainz-userscripts/master/lib/logger.js
// ==/UserScript==

/* Import releases from http://cd1d.com to MusicBrainz */
if (!unsafeWindow) unsafeWindow = window;

// prevent JQuery conflicts, see http://wiki.greasespot.net/@grant
this.$ = this.jQuery = jQuery.noConflict(true);

var CD1DImporter = {

  getFormats: function () {
    // get a list of existing formats, return id of the fragment and name
    var formats = $('#container-1 ul li.ui-state-default').map(function () {
      return {
        id: $(this).find('a:first').attr('href').split('#')[1].split('-'),
        name: $(this).find('span:first').text()
      };
    });
    // remove "parent" formats : ie. digital when mp3 and flac are present
    for (var i = 0; i < formats.length; i++) {
      for (var j = i + 1; j < formats.length; j++) {
        if (formats[j].id.length > 1) {
          if (formats[i].id[1] == formats[j].id[1]) {
            // same prefix (ie. fragment-33123 and fragment-33123-1-2)
            if (formats[i].id.length < formats[j].id.length) {
              formats[i].toremove = true;
            } else if (formats[i].id.length > formats[j].id.length) {
              formats[j].toremove = true;
            }
          }
        }
      }
    }
    var cleanformats = [];
    for (var i = 0; i < formats.length; i++) {
      if (!formats[i].toremove) {
        cleanformats.push({
          id: formats[i].id.join('-'),
          name: formats[i].name
        });
      }
    }
    return cleanformats;
  },

  getTracks: function (id) {
    // extract discs & tracks
    var tracklists = 'div#' + id + ' div.tracklist table.tracklist-content';
    var discs = [];
    $(tracklists).each(function () {
      disc = $(this).find('tbody tr').map(function () {
        // $(this) is used more than once; cache it for performance.
        var row = $(this);

        // For each row that's "mapped", return an object that
        //  describes the first and second <td> in the row.
        var duration = row.find('td.tracklist-content-length').text().replace('"', '').replace('\' ', ':').split(
          ':');
        duration = 60 * parseInt(duration[0]) + parseInt(duration[1]); // convert MM:SS to seconds

        // drop track number prefix (A A2 C3 01 05 etc...)
        var title = row.find('td.tracklist-content-title').text().replace(/^[0-9A-F][0-9]* /, '');
        return {
          title: title,
          duration: duration * 1000 // milliseconds in MB
        };
      }).get();
      discs.push(disc);
    });
    return discs;
  },

  getArtists: function () {
    // get artists
    var artists = $('div.infos-releasegrp div.list-artist a').map(function () {
      return $(this).text();
    }).get();
    artists = artists.map(function (item) {
      return {
        artist_name: item
      };
    });
    if (artists.length > 2) {
      var last = artists.pop();
      last.joinphrase = '';
      var prev = artists.pop();
      prev.joinphrase = ' & ';
      for (var i = 0; i < artists.length; i++) {
        artists[i].joinphrase = ', ';
      }
      artists.push(prev);
      artists.push(last);
    } else if (artists.length == 2) {
      artists[0].joinphrase = ' & ';
    }
    return artists;
  },

  getAlbum: function () {
    // get release title
    return $('h1').text();
  },

  fromCurrentTime: function (offset_in_seconds) {
    var millis = Date.now();
    if (!isNaN(offset_in_seconds)) {
      millis += offset_in_seconds * 1000;
    }
    var date = new Date(millis);
    var dd = date.getDate();
    var mm = date.getMonth() + 1; //January is 0!
    var yyyy = date.getFullYear();
    return {
      'year': yyyy,
      'month': mm,
      'day': dd
    };
  },

  getReleaseDate: function () {
    // get release date and convert it to object
    var text = $('div.infos-releasegrp div.row-date').text();
    if (text == 'yesterday') {
      return this.fromCurrentTime(-24 * 60 * 60);
    }
    if (text == 'today') {
      return this.fromCurrentTime(0);
    }
    var date = text
      .replace('janvier', '01')
      .replace('février', '02')
      .replace('mars', '03')
      .replace('avril', '04')
      .replace('mai', '05')
      .replace('juin', '06')
      .replace('juillet', '07')
      .replace('août', '08')
      .replace('septembre', '09')
      .replace('octobre', '10')
      .replace('novembre', '11')
      .replace('décembre', '12')
      .replace('January', '01')
      .replace('February', '02')
      .replace('March', '03')
      .replace('April', '04')
      .replace('May', '05')
      .replace('June', '06')
      .replace('July', '07')
      .replace('August', '08')
      .replace('September', '09')
      .replace('October', '10')
      .replace('November', '11')
      .replace('December', '12')
      .split(' ');
    return {
      'year': parseInt(date[2]),
      'month': parseInt(date[1]),
      'day': parseInt(date[0])
    };
  },

  currentURL: function () {
    return window.location.href.replace(/\/[a-z]{2}\/album\//i, '/album/').split('#')[0];
  },

  retrieveReleaseInfo: function (format) {
    // Analyze CD1D data and return a release object
    var release = {
      artist_credit: this.getArtists(),
      title: this.getAlbum(),
      country: "", // Worldwide
      type: 'album',
      status: 'official',
      language: 'eng',
      script: 'latn',
      barcode: '',
      urls: [],
      discs: [],
    };

    // Grab release event information
    var releasedate = this.getReleaseDate();
    release.year = releasedate.year;
    release.month = releasedate.month;
    release.day = releasedate.day;

    var link_type = {
      purchase_for_download: 74,
      download_for_free: 75,
      stream_for_free: 85,
      license: 301,
      purchase_for_mail_order: 79
    };

    if (format.name.match(/vinyl|lp/i)) {
      release.country = 'FR';
      release.format = "Vinyl";
      release.urls.push({
        'url': this.currentURL(),
        'link_type': link_type.purchase_for_mail_order
      });
    } else if (format.name.match(/cd/i)) {
      release.country = 'FR';
      release.format = 'CD';
      release.urls.push({
        'url': this.currentURL(),
        'link_type': link_type.purchase_for_mail_order
      });
    } else if (format.name.match(/digital|mp3|flac|ogg|wav/i)) {
      release.country = 'XW';
      release.packaging = 'None';
      release.format = "Digital Media";
      release.urls.push({
        'url': this.currentURL(),
        'link_type': link_type.purchase_for_download
      });
    }

    release.labels = $('div.infos-details div.row-structure').map(function () {
        return {
          name: $(this).text(),
          mbid: '',
          catno: 'none'
        };
      })
      .get();

    // Tracks
    $.each(this.getTracks(format.id), function (ndisc, disc) {
      var thisdisc = {
        tracks: [],
        format: release.format
      };
      release.discs.push(thisdisc);
      $.each(this, function (ntrack, track) {
        thisdisc.tracks.push({
          'title': track.title,
          'duration': track.duration,
          'artist_credit': []
        });
      });
    });

    LOGGER.info("Parsed release: ", format.name, release);
    return release;
  },

  insertLink: function (release, where, formatname) {
    // Insert links in page
    LOGGER.info('insert ', where);
    // Form parameters
    var edit_note = 'Imported from ' + this.currentURL() + ' (' + formatname + ')';
    var parameters = MBReleaseImportHelper.buildFormParameters(release, edit_note);

    // Build form
    var innerHTML = MBReleaseImportHelper.buildFormHTML(parameters);
    $(where).append(innerHTML);

  }
};

$(document).ready(function () {

  /* CD1D uses same page with hidden tabs for all formats */
  var formats = CD1DImporter.getFormats();
  //LOGGER.info('Formats:', formats);

  for (var i = 0; i < formats.length; i++) {
    var release = CD1DImporter.retrieveReleaseInfo(formats[i]);
    CD1DImporter.insertLink(release, 'div#' + formats[i].id, formats[i].name);
  }
});
