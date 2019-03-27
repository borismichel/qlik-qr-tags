import $ from 'jquery';
import qlik from 'qlik';
import { addOnActivateButtonEvent, createSelectionURLPart, createSelctionBreadcrumb } from './utilities';
// import * as qrcode from '../node_modules/qrcode/build/qrcode';


const RECORD_SEPARATOR = '&@#$^()';
const TAG_SEPARATOR = '::::';
const VALUE_SEPARATOR = ';;;;';

// IE is missing "String.includes"
if (!String.prototype.includes) {
  String.prototype.includes = function (search, start) {
    'use strict';
    if (typeof start !== 'number') {
      start = 0;
    }

    if (start + search.length > this.length) {
      return false;
    } else {
      return this.indexOf(search, start) !== -1;
    }
  };
}

var suspectedCountCubeId = null;
var suspectedFieldCount = 0;

function paint ($element, layout, component, qTheme) {
  let buttonText = '';
  let breadcrumb = '';
  var config = {
    host: window.location.hostname,
    prefix: window.location.pathname.substr(0, window.location.pathname.toLowerCase().lastIndexOf("/extensions") + 1),
    port: window.location.port,
    isSecure: window.location.protocol === "https:"
  };

  //Getting the current application
  var app = qlik.currApp(component);
  var applicationId = app.model.layout.qFileName;
  //Adding breadcrumb for QR Code
  breadcrumb += app.model.layout.qTitle + ' // ';
  if (applicationId.substring(applicationId.length - 4) == '.qvf') {
    applicationId = applicationId.slice(0, -4);
  }
  var applicationIdFr = encodeURIComponent(applicationId);

  //Getting the current sheet
  var CurrentSheet = qlik.navigation.getCurrentSheetId();
  var SheetID = CurrentSheet.sheetId;
  app.getObjectProperties(SheetID).then(function(object) {
    breadcrumb += object.layout.qMeta.title;
  });

  //Creating base part of URL including clearing any leftover
  //selections before opening the new page with our selections
  var baseURL = (config.isSecure ? "https://" : "http://" ) + config.host
    + (config.port ? ":" + config.port : "" ) + "/sense/app/" + applicationIdFr
    + "/sheet/" + SheetID + "/state/analysis/options/clearselections";

  //If the user chose to output the link to clipboard only create a button, otherwise create a textbox as well
  let button = $(`<button name="GenerateDashboardLink" id="generateDashboardLink" class="dashboardLinkGenerator" />`);
  button.attr('style', `background-color: ${qTheme.properties.dataColors.primaryColor};`);
  if(layout.outputMethod == "clipboard"){
    buttonText = 'Copy Dashboard Link';
    $element.html(button);
  }
  else if(layout.outputMethod == "textbox"){
    buttonText = 'Generate Link';
    var textboxHTMLCode = '<textarea id="textbox" class="linkTextboxArea" type="text" \
      readOnly="true" style="height: 90%;width: 90%;font-size: 10px;" value="0"/>';
    $element.html(`<table style="height:100%;text-align: center;"><tr><td style="width:20%;"> \
      ${button[0].outerHTML}</td><td style="width:80%;">${textboxHTMLCode}</td></tr></table>`);
    button = $('#generateDashboardLink');
  }
  else if(layout.outputMethod == "qrtag"){
    buttonText = 'Generate QR Tag';
    $element.html(`${button[0].outerHTML}<canvas id="qrcode" style="display: none; width:100%;height:100%"></canvas>`);    
    button = $('#generateDashboardLink');
  }
  var setButtonState = function(label, disabled) {
    button.text(label);
    button.prop("disabled", disabled);
  };
  setButtonState(buttonText, false);

  //If in edit mode, do nothing
  let mode = $element.parent().scope().object.getInteractionState();
  if( mode === 2 ) return;

  const maxValuesSelectedInField = Math.max(1, layout.maxSelected);
  //Create a hypercube with the GetCurrentSelections expression
  app.createCube(
    {
      qMeasures: [{
        qDef: {
          qDef: "=GetCurrentSelections('" + RECORD_SEPARATOR + "','" + TAG_SEPARATOR + "','"
            + VALUE_SEPARATOR + "'," + maxValuesSelectedInField + ")"
        }
      }],
      qInitialDataFetch: [{
        qTop: 0,
        qLeft: 0,
        qHeight: 1,
        qWidth: 1
      }]
    },
    reply => {
      const qMatrix = reply.qHyperCube.qDataPages[0].qMatrix;
      const qText = qMatrix[0][0].qText;

      const fieldSelections = (qText && qText != '-') ? qText.split(RECORD_SEPARATOR) : [];
      if (fieldSelections.length === 0) {
        setButtonState(buttonText, false);
        addOnActivateButtonEvent(
          $element,
          config,
          layout,
          baseURL,
          breadcrumb
        );
        return;
      }

      const selectionPartOfURL = createSelectionURLPart(fieldSelections, TAG_SEPARATOR, VALUE_SEPARATOR, true);
      const selectionBC = createSelctionBreadcrumb(fieldSelections, TAG_SEPARATOR, VALUE_SEPARATOR, true);
      if (!selectionPartOfURL.tooManySelectionsPossible) {
        setButtonState(buttonText, false);
        suspectedFieldCount = 0;
        addOnActivateButtonEvent(
          $element,
          config,
          layout,
          baseURL + selectionPartOfURL.selectionURLPart,
          breadcrumb + '\n' + selectionBC
        );
        return;
      }


      if (suspectedCountCubeId && suspectedFieldCount == selectionPartOfURL.suspectedFields.length) {
        // Already have a selection-count-cube, for these fields, so no need to create a new
        return;
      }

      if (suspectedCountCubeId) {
        // Destroy current select-count-cube before creating a new one
        app.destroySessionObject(suspectedCountCubeId);
        suspectedCountCubeId = null;
        suspectedFieldCount = 0;
      }

      // Create a new hypercube with the number of selections of the suspected fields
      suspectedFieldCount = selectionPartOfURL.suspectedFields.length;
      app.createCube(
        {
          qMeasures: selectionPartOfURL.suspectedFields.map(field => ({
            qDef: {
              qDef: "=GetSelectedCount([" + field + "],True())"
            }
          })),
          qInitialDataFetch: [{
            qTop: 0,
            qLeft: 0,
            qHeight: 1,
            qWidth: suspectedFieldCount
          }]
        },
        reply => {
          suspectedCountCubeId = reply.qInfo.qId;
          const qMatrix = reply.qHyperCube.qDataPages[0].qMatrix;
          const tooManySelectionsMade = qMatrix[0].some(suspectedSelection => (
            parseInt(suspectedSelection.qText) > layout.maxSelected
          ));
          if (tooManySelectionsMade) {
            // If this is the case for at least one field, disable the button
            setButtonState("Too Many Selections", true);
          }
        });
    });
}

export default paint;
