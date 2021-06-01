import bindAll from 'lodash.bindall';
import PropTypes from 'prop-types';
import React from 'react';
import {connect} from 'react-redux';
import {injectIntl, defineMessages, intlShape} from 'react-intl';
import {projectTitleInitialState, setProjectTitle} from '../reducers/project-title';
import downloadBlob from '../lib/download-blob';
import {setProjectUnchanged} from '../reducers/project-changed';
import {showStandardAlert, showAlertWithTimeout} from '../reducers/alerts';
import {setFileHandle, setShowedExtendedExtensionsWarning} from '../reducers/tw';
import FileSystemAPI from '../lib/tw-filesystem-api';

// tw: we make some extensive changes to file saving
//  - use the experimental FileSystem API when possible
//  - saving marks project as unchanged
//  - show spinner while saving and message when finished

const messages = defineMessages({
    error: {
        defaultMessage: `Could not save file. ({error})`,
        description: 'Error displayed when a file could not be saved',
        id: 'tw.fs.saveError'
    }
});

// from sb-file-uploader-hoc.jsx
const getProjectTitleFromFilename = fileInputFilename => {
    if (!fileInputFilename) return '';
    // only parse title with valid scratch project extensions
    // (.sb, .sb2, and .sb3)
    const matches = fileInputFilename.match(/^(.*)\.sb[23]?$/);
    if (!matches) return '';
    return matches[1].substring(0, 100); // truncate project title to max 100 chars
};

/**
 * Project saver component passes a downloadProject function to its child.
 * It expects this child to be a function with the signature
 *     function (downloadProject, props) {}
 * The component can then be used to attach project saving functionality
 * to any other component:
 *
 * <SB3Downloader>{(downloadProject, props) => (
 *     <MyCoolComponent
 *         onClick={downloadProject}
 *         {...props}
 *     />
 * )}</SB3Downloader>
 */
class SB3Downloader extends React.Component {
    constructor (props) {
        super(props);
        bindAll(this, [
            'downloadProject',
            'saveAsNew',
            'saveToLastFile',
            'saveToLastFileOrNew'
        ]);
    }
    startedSaving () {
        this.props.onShowSavingAlert();
    }
    finishedSaving () {
        this.props.onProjectUnchanged();
        this.props.onShowSaveSuccessAlert();
        if (this.props.onSaveFinished) {
            this.props.onSaveFinished();
        }
    }
    downloadProject () {
        this.startedSaving();
        this.props.saveProjectSb3().then(content => {
            if (content.usesExtendedExtensions) {
                if (!this.props.showedExtendedExtensionsWarning) {
                    this.props.onShowExtendedExtensionsWarning();
                }
            }
            this.finishedSaving();
            downloadBlob(this.props.projectFilename, content);
        });
    }
    async saveAsNew () {
        try {
            const handle = await FileSystemAPI.showSaveFilePicker(this.props.projectFilename);
            await this.saveToHandle(handle);
            this.props.onSetFileHandle(handle);
            const title = getProjectTitleFromFilename(handle.name);
            if (title) {
                this.props.onSetProjectTitle(title);
            }
        } catch (e) {
            this.handleSaveError(e);
        }
    }
    async saveToLastFile () {
        try {
            await this.saveToHandle(this.props.fileHandle);
        } catch (e) {
            this.handleSaveError(e);
        }
    }
    saveToLastFileOrNew () {
        if (this.props.fileHandle) {
            return this.saveToLastFile();
        }
        return this.saveAsNew();
    }
    async saveToHandle (handle) {
        // Obtain the writable very early, otherwise browsers won't give us the handle when we ask.
        const writable = await FileSystemAPI.createWritable(handle);
        try {
            this.startedSaving();
            const content = await this.props.saveProjectSb3();
            await FileSystemAPI.writeToWritable(writable, content);
            this.finishedSaving();
        } finally {
            // Always close the handle regardless of errors.
            await FileSystemAPI.closeWritable(writable);
        }
    }
    handleSaveError (e) {
        // If user aborted process, do not show an error.
        if (e && e.name === 'AbortError') {
            return;
        }
        this.props.onShowSaveErrorAlert();
        // eslint-disable-next-line no-console
        console.error(e);
        // eslint-disable-next-line no-alert
        alert(this.props.intl.formatMessage(messages.error, {
            error: `${e}`
        }));
    }
    render () {
        const {
            children
        } = this.props;
        return children(
            this.props.className,
            this.downloadProject,
            FileSystemAPI.available() ? {
                available: true,
                name: this.props.fileHandle ? this.props.fileHandle.name : null,
                saveAsNew: this.saveAsNew,
                saveToLastFile: this.saveToLastFile,
                saveToLastFileOrNew: this.saveToLastFileOrNew,
                smartSave: this.saveToLastFileOrNew
            } : {
                available: false,
                smartSave: this.downloadProject
            }
        );
    }
}

const getProjectFilename = (curTitle, defaultTitle) => {
    let filenameTitle = curTitle;
    if (!filenameTitle || filenameTitle.length === 0) {
        filenameTitle = defaultTitle;
    }
    return `${filenameTitle.substring(0, 100)}.sb3`;
};

SB3Downloader.propTypes = {
    children: PropTypes.func,
    intl: intlShape,
    className: PropTypes.string,
    fileHandle: PropTypes.shape({
        name: PropTypes.string
    }),
    onSaveFinished: PropTypes.func,
    projectFilename: PropTypes.string,
    saveProjectSb3: PropTypes.func,
    showedExtendedExtensionsWarning: PropTypes.bool,
    onShowExtendedExtensionsWarning: PropTypes.func,
    onSetFileHandle: PropTypes.func,
    onSetProjectTitle: PropTypes.func,
    onShowSavingAlert: PropTypes.func,
    onShowSaveSuccessAlert: PropTypes.func,
    onShowSaveErrorAlert: PropTypes.func,
    onProjectUnchanged: PropTypes.func
};
SB3Downloader.defaultProps = {
    className: ''
};

const mapStateToProps = state => ({
    fileHandle: state.scratchGui.tw.fileHandle,
    saveProjectSb3: state.scratchGui.vm.saveProjectSb3.bind(state.scratchGui.vm),
    projectFilename: getProjectFilename(state.scratchGui.projectTitle, projectTitleInitialState),
    showedExtendedExtensionsWarning: state.scratchGui.tw.showedExtendedExtensionsWarning
});

const mapDispatchToProps = dispatch => ({
    onSetFileHandle: fileHandle => dispatch(setFileHandle(fileHandle)),
    onShowExtendedExtensionsWarning: () => {
        dispatch(showStandardAlert('twExtendedExtensionsWarning'));
        dispatch(setShowedExtendedExtensionsWarning(true));
    },
    onSetProjectTitle: title => dispatch(setProjectTitle(title)),
    onShowSavingAlert: () => showAlertWithTimeout(dispatch, 'saving'),
    onShowSaveSuccessAlert: () => showAlertWithTimeout(dispatch, 'twSaveToDiskSuccess'),
    onShowSaveErrorAlert: () => dispatch(showStandardAlert('savingError')),
    onProjectUnchanged: () => dispatch(setProjectUnchanged())
});

export default injectIntl(connect(
    mapStateToProps,
    mapDispatchToProps
)(SB3Downloader));
